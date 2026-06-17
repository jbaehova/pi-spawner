import { mkdir, writeFile } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { join } from "node:path";
import { adaptersRoot, userConfigPath } from "./paths.js";

export interface AdapterGuide {
  root: string;
  codexPath: string;
  claudePath: string;
  cursorPath: string;
  hermesPath: string;
  text: string;
}

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
    writeSkillOnlyAdapter(hermesPath, command)
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
    version: "0.3.0",
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
  compatibility: Requires npm-installed pi-spawner, Python 3.10+, pi CLI on PATH, and provider authentication configured in Pi.
---

# Pi Spawner

Use this skill when the host agent should keep control while consulting Pi CLI model workers for review, planning, writing, design critique, code alternatives, or explicitly requested direct edits.

## Required Preflight

If delegation fails or the user appears not to have completed setup, ask them to run:

\`\`\`bash
pi-spawner doctor
\`\`\`

The doctor command checks for Pi CLI, Python 3.10+, provider credentials, a valid model catalog, and the Pi Spawner config at ${userConfigPath()}.

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
Use \`alias\` when the user names a configured alias such as \`kimi\`, \`deepseek\`, \`qwen\`, or \`gemini\`.
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
  codex plugin add ${codexPath}

Claude Code:
  claude --plugin-dir ${claudePath}

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

function cliInvocation(): string {
  const scriptPath = process.argv[1];
  if (!scriptPath) {
    return "pi-spawner";
  }
  const resolvedScriptPath = realpathSync(scriptPath);
  return `${shellQuote(process.execPath)} ${shellQuote(resolvedScriptPath)}`;
}

function shellQuote(value: string): string {
  if (/^[A-Za-z0-9_./:@%+=,-]+$/.test(value)) {
    return value;
  }
  return `'${value.replaceAll("'", "'\\''")}'`;
}
