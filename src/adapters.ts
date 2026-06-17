import { spawn, spawnSync } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { copyFile, lstat, mkdir, readFile, readdir, readlink, rm, symlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { adaptersRoot, userConfigPath } from "./paths.js";

export const HOST_IDS = ["codex", "claude-code", "cursor", "hermes"] as const;

export type HostId = (typeof HOST_IDS)[number];

export interface HostStatus {
  id: HostId;
  label: string;
  available: boolean;
  installed: boolean;
  detail: string;
}

export interface HostInstallResult {
  id: HostId;
  label: string;
  ok: boolean;
  detail: string;
  commands: string[];
}

export interface InstallHostsOptions {
  repairBrokenCodexMarketplace?: boolean;
  updateInstalled?: boolean;
}

export interface AdapterGuide {
  root: string;
  codexPath: string;
  claudePath: string;
  cursorPath: string;
  hermesPath: string;
  text: string;
}

interface CommandResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  error?: string;
}

interface CodexPluginTarget {
  pluginRoot: string;
  marketplacePath: string;
  marketplaceName: string;
}

interface ClaudePluginTarget {
  marketplaceRoot: string;
  pluginRoot: string;
  marketplaceName: string;
}

const HOST_LABELS: Record<HostId, string> = {
  codex: "Codex",
  "claude-code": "Claude Code",
  cursor: "Cursor",
  hermes: "Hermes Agent"
};

export async function ensureAdapters(): Promise<AdapterGuide> {
  const root = adaptersRoot();
  const codexPath = join(root, "codex");
  const claudePath = join(root, "claude-code");
  const cursorPath = join(root, "cursor");
  const hermesPath = join(root, "hermes");
  const command = cliInvocation();

  await Promise.all([
    writeAdapter(codexPath, ".codex-plugin", command),
    writeAdapter(claudePath, ".claude-plugin", command),
    writeAdapter(cursorPath, ".cursor-plugin", command),
    writeSkillOnlyAdapter(hermesPath, command),
    ensureClaudeMarketplace(command)
  ]);

  return {
    root,
    codexPath,
    claudePath,
    cursorPath,
    hermesPath,
    text: guideText(root, codexPath, claudePath, cursorPath, hermesPath, command)
  };
}

export async function detectHosts(): Promise<HostStatus[]> {
  const [codex, claude, cursorCli, hermes] = await Promise.all([
    commandOnPath("codex"),
    commandOnPath("claude"),
    commandOnPath("cursor"),
    commandOnPath("hermes")
  ]);
  const cursorApp = existsSync("/Applications/Cursor.app") || existsSync(join(homedir(), "Applications", "Cursor.app"));
  const [codexInstalled, claudeInstalled, cursorInstalled, hermesInstalled] = await Promise.all([
    codex ? codexPluginInstalled() : false,
    claude ? claudePluginInstalled() : false,
    isCursorAdapterInstalled(),
    hermes ? hermesSkillInstalled() : false
  ]);

  return [
    {
      id: "codex",
      label: HOST_LABELS.codex,
      available: codex,
      installed: codexInstalled,
      detail: codex
        ? codexInstalled
          ? "Codex CLI found. Pi Spawner is installed; the wizard can refresh it."
          : "Codex CLI found. The wizard will install through the personal marketplace."
        : "Codex CLI was not found on PATH."
    },
    {
      id: "claude-code",
      label: HOST_LABELS["claude-code"],
      available: claude,
      installed: claudeInstalled,
      detail: claude
        ? claudeInstalled
          ? "Claude Code CLI found. Pi Spawner appears installed; the wizard can refresh it."
          : "Claude Code CLI found. The wizard will add a local marketplace and install the plugin."
        : "Claude Code CLI was not found on PATH."
    },
    {
      id: "cursor",
      label: HOST_LABELS.cursor,
      available: cursorCli || cursorApp,
      installed: cursorInstalled,
      detail: cursorCli || cursorApp
        ? "Cursor was detected. The wizard will install a local plugin symlink."
        : "Cursor was not found on PATH or in /Applications."
    },
    {
      id: "hermes",
      label: HOST_LABELS.hermes,
      available: hermes,
      installed: hermesInstalled,
      detail: hermes
        ? hermesInstalled
          ? "Hermes CLI found. Pi Spawner skill appears installed; the wizard can refresh it."
          : "Hermes CLI found. The wizard will run `hermes skills install`."
        : "Hermes CLI was not found on PATH."
    }
  ];
}

export async function installHosts(hosts: HostId[], options: InstallHostsOptions = {}): Promise<HostInstallResult[]> {
  const results: HostInstallResult[] = [];
  for (const host of hosts) {
    results.push(await installHost(host, options));
  }
  return results;
}

export async function installHost(host: HostId, options: InstallHostsOptions = {}): Promise<HostInstallResult> {
  try {
    if (host === "codex") {
      return await installCodex(options);
    }
    if (host === "claude-code") {
      return await installClaudeCode();
    }
    if (host === "cursor") {
      return await installCursor();
    }
    return await installHermes();
  } catch (error) {
    return {
      id: host,
      label: HOST_LABELS[host],
      ok: false,
      detail: error instanceof Error ? error.message : String(error),
      commands: []
    };
  }
}

export async function ensureCodexPersonalPlugin(command = cliInvocation()): Promise<CodexPluginTarget> {
  const pluginRoot = join(homedir(), "plugins", "pi-spawner");
  const marketplacePath = join(homedir(), ".agents", "plugins", "marketplace.json");
  await assertSafeCodexPluginRoot(pluginRoot);
  await writeAdapter(pluginRoot, ".codex-plugin", command);
  const marketplace = await upsertCodexMarketplace(marketplacePath);
  return {
    pluginRoot,
    marketplacePath,
    marketplaceName: marketplace.name
  };
}

export async function ensureClaudeMarketplace(command = cliInvocation()): Promise<ClaudePluginTarget> {
  const marketplaceRoot = join(adaptersRoot(), "claude-marketplace");
  const pluginRoot = join(marketplaceRoot, "plugins", "pi-spawner");
  const marketplaceName = "pi-spawner";
  await writeAdapter(pluginRoot, ".claude-plugin", command);
  await mkdir(join(marketplaceRoot, ".claude-plugin"), { recursive: true });
  await writeFile(
    join(marketplaceRoot, ".claude-plugin", "marketplace.json"),
    `${JSON.stringify(buildClaudeMarketplace(marketplaceName), null, 2)}\n`,
    "utf8"
  );
  return { marketplaceRoot, pluginRoot, marketplaceName };
}

export function buildCodexMarketplace(existing: unknown): { name: string; payload: Record<string, unknown> } {
  const payload = isRecord(existing) ? structuredClone(existing) : {};
  const name = typeof payload.name === "string" && payload.name.trim() ? payload.name.trim() : "personal";
  payload.name = name;
  if (!isRecord(payload.interface)) {
    payload.interface = { displayName: displayNameFromName(name) };
  }
  const plugins = Array.isArray(payload.plugins) ? payload.plugins.filter((item) => isRecord(item)) : [];
  const entry = {
    name: "pi-spawner",
    source: {
      source: "local",
      path: "./plugins/pi-spawner"
    },
    policy: {
      installation: "AVAILABLE",
      authentication: "ON_INSTALL"
    },
    category: "Productivity"
  };
  const index = plugins.findIndex((item) => item.name === "pi-spawner");
  if (index === -1) {
    plugins.push(entry);
  } else {
    plugins[index] = entry;
  }
  payload.plugins = plugins;
  return { name, payload };
}

export function buildClaudeMarketplace(name = "pi-spawner"): Record<string, unknown> {
  return {
    name,
    owner: {
      name: "Johnny Bae"
    },
    description: "Pi Spawner host adapter marketplace",
    plugins: [
      {
        name: "pi-spawner",
        source: "./plugins/pi-spawner",
        description: "Delegate work to Pi model workers through the global pi-spawner CLI",
        version: "0.4.0",
        category: "Productivity"
      }
    ]
  };
}

async function writeAdapter(root: string, manifestDir: ".codex-plugin" | ".claude-plugin" | ".cursor-plugin", command: string): Promise<void> {
  await mkdir(join(root, manifestDir), { recursive: true });
  await mkdir(join(root, "skills", "pi-spawner"), { recursive: true });
  await writeFile(join(root, manifestDir, "plugin.json"), `${JSON.stringify(pluginManifest(manifestDir), null, 2)}\n`, "utf8");
  await writeFile(join(root, "skills", "pi-spawner", "SKILL.md"), skillMarkdown(command), "utf8");
  await writeFile(join(root, "README.md"), adapterReadme(root, command), "utf8");
}

async function writeSkillOnlyAdapter(root: string, command: string): Promise<void> {
  await mkdir(join(root, "skills", "pi-spawner"), { recursive: true });
  await writeFile(join(root, "skills", "pi-spawner", "SKILL.md"), skillMarkdown(command), "utf8");
  await writeFile(join(root, "README.md"), adapterReadme(root, command), "utf8");
}

function pluginManifest(manifestDir: string): Record<string, unknown> {
  const manifest: Record<string, unknown> = {
    name: "pi-spawner",
    version: "0.4.0",
    description: "Delegate tasks to Pi Spawner through the global pi-spawner CLI.",
    author: {
      name: "Johnny Bae",
      url: "https://github.com/jbaehova"
    },
    homepage: "https://github.com/jbaehova/pi-spawner",
    repository: "https://github.com/jbaehova/pi-spawner",
    license: "MIT",
    skills: "./skills/"
  };

  if (manifestDir === ".codex-plugin") {
    manifest.interface = {
      displayName: "Pi Spawner",
      shortDescription: "Delegate work to Pi model workers",
      longDescription: "Pi Spawner lets Codex call the globally installed pi-spawner CLI, using npm-managed settings, preflight checks, aliases, routes, providers, models, thinking levels, and safe read-by-default worker delegation.",
      developerName: "Johnny Bae",
      category: "Productivity",
      capabilities: ["Read", "Write"],
      websiteURL: "https://github.com/jbaehova/pi-spawner",
      defaultPrompt: ["Use Pi workers to review this", "Ask Kimi and DeepSeek for alternatives"]
    };
  }

  if (manifestDir === ".cursor-plugin") {
    manifest.displayName = "Pi Spawner";
  }

  return manifest;
}

function skillMarkdown(command: string): string {
  return `---
name: pi-spawner
description: Delegate host coding-agent subtasks to the globally installed pi-spawner CLI, which manages aliases, routes, providers, models, and thinking levels under ~/.pi/pi-spawner.
metadata:
  compatibility: Requires npm-installed pi-spawner, Python 3.9+, pi CLI on PATH, and provider authentication configured in Pi.
---

# Pi Spawner

Use this skill when the host agent should keep control while consulting Pi CLI model workers for review, planning, writing, design critique, code alternatives, or explicitly requested direct edits.

## Required Preflight

If delegation fails or the user appears not to have completed setup, ask them to run:

\`\`\`bash
pi-spawner doctor
\`\`\`

The doctor command checks for Pi CLI, Python 3.9+, provider credentials, a valid model catalog, and the Pi Spawner config at ${userConfigPath()}.

## How To Delegate

Build a JSON spec and pass it to the global CLI:

\`\`\`bash
${command} delegate --dry-run <<'JSON'
{
  "cwd": "/path/to/repo",
  "orchestrator_name": "Host Agent",
  "tasks": [
    {
      "id": "review",
      "route": "review",
      "prompt": "Find regression risks in the current diff."
    }
  ]
}
JSON
\`\`\`

Remove \`--dry-run\` to execute the workers.

## Selection Rules

Use \`route\` for normal delegation: \`code\`, \`plan\`, \`writing\`, \`review\`, or \`design\`.
Use \`alias\` when the user names a configured alias such as \`sonnet\`, \`gpt\`, \`kimi\`, \`deepseek\`, \`qwen\`, or \`gemini\`.
Use exact \`provider\`, \`model\`, and \`thinking\` only when the user asks for them.

The global CLI reads user settings from ${userConfigPath()} unless \`config_path\` or \`PI_SPAWNER_CONFIG\` overrides it.

If this adapter stops finding the CLI after moving Node/npm installations, regenerate it with \`pi-spawner hosts\`.

## Safety

Default tasks are read-only. Use \`permission: "write"\` only when direct file edits are intended; Pi Spawner then captures before/after filesystem changes for host review.
Do not silently switch aliases, routes, providers, or models if Pi reports auth or model failures.
`;
}

function adapterReadme(root: string, command: string): string {
  return `# Pi Spawner Adapter

Generated by \`pi-spawner hosts\`.

This adapter does not contain the delegation runtime. It calls:

\`\`\`bash
${command} delegate
\`\`\`

Regenerate it with \`pi-spawner hosts\` if you move Node/npm installations.

Adapter path:

\`\`\`text
${root}
\`\`\`

Run \`pi-spawner doctor\` if this adapter cannot delegate.
`;
}

function guideText(root: string, codexPath: string, claudePath: string, cursorPath: string, hermesPath: string, command: string): string {
  return `Pi Spawner host adapters

Generated under:
  ${root}

Codex:
  Run \`pi-spawner\` and use the setup wizard.
  Codex installs through the personal marketplace, not direct path install.

Claude Code:
  Run \`pi-spawner\` and use the setup wizard, or add the generated marketplace under ${root}/claude-marketplace.

Cursor:
  mkdir -p ~/.cursor/plugins/local
  ln -sfn ${cursorPath} ~/.cursor/plugins/local/pi-spawner

Hermes Agent:
  hermes skills install ${join(hermesPath, "skills", "pi-spawner")}

All adapters call:
  ${command} delegate

Settings:
  ${userConfigPath()}
`;
}

async function installCodex(options: InstallHostsOptions): Promise<HostInstallResult> {
  if (!(await commandOnPath("codex"))) {
    throw new Error("Codex CLI was not found on PATH.");
  }
  const target = await ensureCodexPersonalPlugin();
  const commands = [`codex plugin add pi-spawner@${target.marketplaceName}`];
  const list = await runCommand("codex", ["plugin", "list", "--json"], 10000);
  const brokenMarketplaces = brokenPiSpawnerMarketplaceNames(list);
  if (!list.ok && brokenMarketplaces.length) {
    if (!options.repairBrokenCodexMarketplace) {
      throw new Error("Codex has a broken `pi-spawner` marketplace entry. Re-run with repair enabled.");
    }
    for (const marketplace of brokenMarketplaces) {
      commands.unshift(`codex plugin marketplace remove ${marketplace}`);
      const remove = await runCommand("codex", ["plugin", "marketplace", "remove", marketplace, "--json"], 15000);
      if (!remove.ok && !isNotConfigured(remove)) {
        throw new Error(`Could not remove broken Codex marketplace ${marketplace}: ${commandFailure(remove)}`);
      }
    }
  } else if (list.ok && codexListHasInstalledPlugin(list.stdout, target.marketplaceName) && !options.updateInstalled) {
    return {
      id: "codex",
      label: HOST_LABELS.codex,
      ok: true,
      detail: `Already installed from ${target.marketplacePath}`,
      commands
    };
  }

  if (options.updateInstalled && list.ok && codexListHasInstalledPlugin(list.stdout, target.marketplaceName)) {
    const remove = await runCommand("codex", ["plugin", "remove", `pi-spawner@${target.marketplaceName}`, "--json"], 30000);
    commands.unshift(`codex plugin remove pi-spawner@${target.marketplaceName}`);
    if (!remove.ok && !isNotInstalled(remove)) {
      throw new Error(`Codex update remove failed: ${commandFailure(remove)}`);
    }
  }

  const add = await runCommand("codex", ["plugin", "add", `pi-spawner@${target.marketplaceName}`, "--json"], 30000);
  if (!add.ok && isAlreadyInstalled(add)) {
    return {
      id: "codex",
      label: HOST_LABELS.codex,
      ok: true,
      detail: `Already installed from ${target.marketplacePath}`,
      commands
    };
  }
  if (!add.ok) {
    throw new Error(`Codex install failed: ${commandFailure(add)}`);
  }
  return {
    id: "codex",
    label: HOST_LABELS.codex,
    ok: true,
    detail: `Installed from ${target.marketplacePath}`,
    commands
  };
}

async function installClaudeCode(): Promise<HostInstallResult> {
  if (!(await commandOnPath("claude"))) {
    throw new Error("Claude Code CLI was not found on PATH.");
  }
  const target = await ensureClaudeMarketplace();
  const commands = [
    `claude plugin marketplace add ${target.marketplaceRoot} --scope user`,
    `claude plugin install pi-spawner@${target.marketplaceName} --scope user`
  ];
  const addMarketplace = await runCommand("claude", ["plugin", "marketplace", "add", target.marketplaceRoot, "--scope", "user"], 30000);
  if (!addMarketplace.ok && !isAlreadyConfigured(addMarketplace)) {
    throw new Error(`Claude marketplace add failed: ${commandFailure(addMarketplace)}`);
  }
  const install = await runCommand("claude", ["plugin", "install", `pi-spawner@${target.marketplaceName}`, "--scope", "user"], 30000);
  if (!install.ok && !isAlreadyInstalled(install)) {
    throw new Error(`Claude plugin install failed: ${commandFailure(install)}`);
  }
  return {
    id: "claude-code",
    label: HOST_LABELS["claude-code"],
    ok: true,
    detail: `Installed from ${target.marketplaceRoot}`,
    commands
  };
}

async function installCursor(): Promise<HostInstallResult> {
  const guide = await ensureAdapters();
  const target = join(homedir(), ".cursor", "plugins", "local", "pi-spawner");
  await mkdir(dirname(target), { recursive: true });
  const existingTarget = await lstatIfExists(target);
  if (existingTarget) {
    const stat = existingTarget;
    if (!stat.isSymbolicLink()) {
      throw new Error(`${target} already exists and is not a symlink. Move it first, then retry.`);
    }
    if (await symlinkPointsTo(target, guide.cursorPath)) {
      return {
        id: "cursor",
        label: HOST_LABELS.cursor,
        ok: true,
        detail: `Already linked ${target} -> ${guide.cursorPath}`,
        commands: [
          "mkdir -p ~/.cursor/plugins/local",
          `ln -sfn ${guide.cursorPath} ~/.cursor/plugins/local/pi-spawner`
        ]
      };
    }
    throw new Error(`${target} already points to a different plugin. Move it first, then retry.`);
  }
  await symlink(guide.cursorPath, target, "dir");
  return {
    id: "cursor",
    label: HOST_LABELS.cursor,
    ok: true,
    detail: `Linked ${target} -> ${guide.cursorPath}`,
    commands: [
      "mkdir -p ~/.cursor/plugins/local",
      `ln -sfn ${guide.cursorPath} ~/.cursor/plugins/local/pi-spawner`
    ]
  };
}

async function installHermes(): Promise<HostInstallResult> {
  if (!(await commandOnPath("hermes"))) {
    throw new Error("Hermes CLI was not found on PATH.");
  }
  const guide = await ensureAdapters();
  const skillPath = join(guide.hermesPath, "skills", "pi-spawner");
  const command = `hermes skills install ${skillPath}`;
  const install = await runCommand("hermes", ["skills", "install", skillPath], 30000);
  if (!install.ok && !isAlreadyInstalled(install)) {
    throw new Error(`Hermes skill install failed: ${commandFailure(install)}`);
  }
  return {
    id: "hermes",
    label: HOST_LABELS.hermes,
    ok: true,
    detail: `Installed ${skillPath}`,
    commands: [command]
  };
}

async function upsertCodexMarketplace(path: string): Promise<{ name: string }> {
  let existing: unknown = {};
  if (existsSync(path)) {
    existing = await readJsonOrBackup(path);
  }
  const { name, payload } = buildCodexMarketplace(existing);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  return { name };
}

async function readJsonOrBackup(path: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error instanceof SyntaxError) {
      const backupPath = `${path}.invalid-${new Date().toISOString().replace(/[:.]/g, "-")}`;
      await copyFile(path, backupPath);
      return {};
    }
    throw error;
  }
}

async function assertSafeCodexPluginRoot(pluginRoot: string): Promise<void> {
  if (!existsSync(pluginRoot)) {
    return;
  }
  const manifestPath = join(pluginRoot, ".codex-plugin", "plugin.json");
  if (existsSync(manifestPath)) {
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    if (isPiSpawnerManifest(manifest)) {
      return;
    }
    throw new Error(`${pluginRoot} already contains a different Codex plugin. Move it first, then retry.`);
  }
  const entries = await readdir(pluginRoot);
  if (entries.length) {
    throw new Error(`${pluginRoot} already exists and is not a Pi Spawner plugin. Move it first, then retry.`);
  }
}

function isPiSpawnerManifest(manifest: unknown): boolean {
  if (!isRecord(manifest) || manifest.name !== "pi-spawner") {
    return false;
  }
  const homepage = typeof manifest.homepage === "string" ? manifest.homepage : "";
  const repository = isRecord(manifest.repository) && typeof manifest.repository.url === "string" ? manifest.repository.url : "";
  const description = typeof manifest.description === "string" ? manifest.description : "";
  return homepage.includes("pi-spawner") || repository.includes("pi-spawner") || description.includes("Pi Spawner");
}

async function codexPluginInstalled(): Promise<boolean> {
  if (!(await commandOnPath("codex"))) {
    return false;
  }
  const result = await runCommand("codex", ["plugin", "list", "--json"], 10000);
  if (!result.ok) {
    return false;
  }
  return codexListHasInstalledPlugin(result.stdout);
}

async function claudePluginInstalled(): Promise<boolean> {
  const json = await runCommand("claude", ["plugin", "list", "--json"], 10000);
  if (json.ok && jsonListMentions(json.stdout, "pi-spawner")) {
    return true;
  }
  const text = await runCommand("claude", ["plugin", "list"], 10000);
  return text.ok && text.stdout.includes("pi-spawner");
}

async function hermesSkillInstalled(): Promise<boolean> {
  const json = await runCommand("hermes", ["skills", "list", "--json"], 10000);
  if (json.ok && jsonListMentions(json.stdout, "pi-spawner")) {
    return true;
  }
  const text = await runCommand("hermes", ["skills", "list"], 10000);
  return text.ok && text.stdout.includes("pi-spawner");
}

async function isCursorAdapterInstalled(): Promise<boolean> {
  const target = join(homedir(), ".cursor", "plugins", "local", "pi-spawner");
  try {
    const stat = await lstatIfExists(target);
    return Boolean(stat?.isSymbolicLink() && await symlinkPointsTo(target, join(adaptersRoot(), "cursor")));
  } catch {
    return false;
  }
}

async function lstatIfExists(path: string): Promise<Awaited<ReturnType<typeof lstat>> | null> {
  try {
    return await lstat(path);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

async function symlinkPointsTo(linkPath: string, expectedTarget: string): Promise<boolean> {
  const linkTarget = await readlink(linkPath);
  const resolvedLinkTarget = resolve(dirname(linkPath), linkTarget);
  return resolvedLinkTarget === resolve(expectedTarget);
}

async function commandOnPath(command: string): Promise<boolean> {
  const result = await runCommand("sh", ["-lc", `command -v ${shellQuote(command)}`], 5000);
  return result.ok && result.stdout.trim().length > 0;
}

export function brokenPiSpawnerMarketplaceNames(result: CommandResult): string[] {
  const text = `${result.stdout}\n${result.stderr}\n${result.error || ""}`;
  if (!text.includes("marketplace root does not contain a supported manifest")) {
    return [];
  }
  const names = new Set<string>();
  for (const match of text.matchAll(/- `([^`]+)` at [^\n]+marketplace root does not contain a supported manifest/g)) {
    if (match[1] === "pi-spawner") {
      names.add(match[1]);
    }
  }
  if (!names.size && text.includes("`pi-spawner`")) {
    names.add("pi-spawner");
  }
  return [...names];
}

export function codexListHasInstalledPlugin(stdout: string, marketplaceName?: string): boolean {
  return jsonListMentions(stdout, "pi-spawner", marketplaceName);
}

function jsonListMentions(stdout: string, pluginName: string, marketplaceName?: string): boolean {
  try {
    return jsonMentionsPlugin(JSON.parse(stdout), pluginName, marketplaceName);
  } catch {
    return stdout.includes(pluginName) && (!marketplaceName || stdout.includes(marketplaceName));
  }
}

function jsonMentionsPlugin(value: unknown, pluginName: string, marketplaceName?: string): boolean {
  if (Array.isArray(value)) {
    return value.some((item) => jsonMentionsPlugin(item, pluginName, marketplaceName));
  }
  if (!isRecord(value)) {
    return false;
  }
  const name = stringValue(value.name) || stringValue(value.plugin) || stringValue(value.id);
  const marketplace = stringValue(value.marketplace) || stringValue(value.marketplaceName);
  if (name === pluginName && (!marketplaceName || !marketplace || marketplace === marketplaceName)) {
    return true;
  }
  return Object.values(value).some((child) => jsonMentionsPlugin(child, pluginName, marketplaceName));
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function isAlreadyConfigured(result: CommandResult): boolean {
  const text = commandFailure(result).toLowerCase();
  return text.includes("already") && (text.includes("configured") || text.includes("exists") || text.includes("added"));
}

function isAlreadyInstalled(result: CommandResult): boolean {
  const text = commandFailure(result).toLowerCase();
  return text.includes("already") && (text.includes("installed") || text.includes("exists"));
}

function isNotConfigured(result: CommandResult): boolean {
  const text = commandFailure(result).toLowerCase();
  return text.includes("not") && (text.includes("configured") || text.includes("found"));
}

function isNotInstalled(result: CommandResult): boolean {
  const text = commandFailure(result).toLowerCase();
  return text.includes("not") && (text.includes("installed") || text.includes("found"));
}

function commandFailure(result: CommandResult): string {
  const parts = [
    result.error,
    result.stderr.trim(),
    result.stdout.trim(),
    result.exitCode === null ? undefined : `exit ${result.exitCode}`
  ].filter(Boolean);
  const detail = parts.join("; ") || "unknown failure";
  if (result.error?.startsWith("timed out")) {
    return `${detail}; the command may be waiting for confirmation or blocked on host CLI state`;
  }
  return detail;
}

async function runCommand(command: string, args: string[], timeoutMs: number): Promise<CommandResult> {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        CI: process.env.CI || "1",
        NO_COLOR: process.env.NO_COLOR || "1"
      }
    });
    let stdout = "";
    let stderr = "";
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      child.kill("SIGTERM");
      resolve({ ok: false, stdout, stderr, exitCode: null, error: `timed out after ${timeoutMs}ms` });
    }, timeoutMs);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (error: NodeJS.ErrnoException) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolve({ ok: false, stdout, stderr, exitCode: error.code === "ENOENT" ? 127 : null, error: error.message });
    });
    child.on("close", (code) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolve({ ok: code === 0, stdout, stderr, exitCode: code });
    });
  });
}

function cliInvocation(): string {
  const override = process.env.PI_SPAWNER_ADAPTER_COMMAND;
  if (override?.trim()) {
    return override.trim();
  }
  const scriptPath = process.argv[1];
  if (!scriptPath) {
    return "pi-spawner";
  }
  const resolvedScriptPath = realpathSync(scriptPath);
  const piSpawnerPath = commandPathSync("pi-spawner");
  if (piSpawnerPath) {
    try {
      if (realpathSync(piSpawnerPath) === resolvedScriptPath) {
        return "pi-spawner";
      }
    } catch {
      // Fall through to the absolute Node invocation.
    }
  }
  return `${shellQuote(process.execPath)} ${shellQuote(resolvedScriptPath)}`;
}

function commandPathSync(command: string): string | null {
  const result = spawnSync("sh", ["-lc", `command -v ${shellQuote(command)}`], {
    encoding: "utf8",
    timeout: 5000
  });
  if (result.status !== 0) {
    return null;
  }
  return result.stdout.trim() || null;
}

function shellQuote(value: string): string {
  if (/^[A-Za-z0-9_./:@%+=,-]+$/.test(value)) {
    return value;
  }
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function displayNameFromName(name: string): string {
  return name
    .split(/[-_]+/)
    .filter(Boolean)
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(" ") || "Personal";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
