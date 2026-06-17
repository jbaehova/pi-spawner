import {
  cancel,
  confirm,
  intro,
  isCancel,
  log,
  multiselect,
  note,
  outro,
  select,
  spinner,
  text
} from "@clack/prompts";
import searchPrompt from "@inquirer/search";
import { stdin as input, stdout as output } from "node:process";
import { installHosts, detectHosts, HostId } from "./adapters.js";
import { ensureUserConfig, isThinkingLevel, loadUserConfig, normalizeAlias, routeProviderIssues, writeConfig } from "./config.js";
import { detectAuthProviders, formatDoctorReport, runDoctor } from "./doctor.js";
import { listModels } from "./models.js";
import { userConfigPath } from "./paths.js";
import { ModelInfo, PiSpawnerConfig, THINKING_LEVELS, ThinkingLevel } from "./types.js";

const STANDARD_ROUTES = ["code", "plan", "writing", "review", "design"] as const;

type SetupAction = "continue" | "details" | "quit";
type RouteChoice = (typeof STANDARD_ROUTES)[number] | "custom";

class TuiCancelled extends Error {
  constructor() {
    super("TUI cancelled");
  }
}

export async function runTui(): Promise<void> {
  await ensureUserConfig();
  if (!input.isTTY) {
    output.write("Pi Spawner TUI requires an interactive terminal.\n");
    output.write("Use `pi-spawner doctor`, `pi-spawner config`, `pi-spawner aliases`, or `pi-spawner routes` for non-interactive automation.\n");
    return;
  }

  intro("Pi Spawner Setup");
  try {
    await doctorStep();
    await modelAndRouteStep();
    await runtimeStep();
    await hostInstallStep();
    outro("Pi Spawner setup complete.");
  } catch (error) {
    if (error instanceof TuiCancelled || isInquirerCancel(error)) {
      cancel("Setup cancelled.");
      return;
    }
    throw error;
  }
}

async function doctorStep(): Promise<void> {
  const s = spinner();
  s.start("Checking Pi, Python, provider auth, config, and model catalog");
  const report = await runDoctor();
  s.stop(report.ok ? "Doctor checks passed" : "Doctor found setup issues");

  note(doctorSummary(report), "Doctor");
  if (report.ok) {
    return;
  }

  while (true) {
    const action = await prompt(
      select<SetupAction>({
        message: "Some setup is missing. What should happen next?",
        options: [
          { value: "continue", label: "Continue setup", hint: "configure what can be configured now" },
          { value: "details", label: "View details", hint: "show full doctor output" },
          { value: "quit", label: "Quit" }
        ],
        initialValue: "continue"
      })
    );
    if (action === "continue") {
      return;
    }
    if (action === "quit") {
      throw new TuiCancelled();
    }
    note(formatDoctorReport(report), "Doctor details");
  }
}

async function modelAndRouteStep(): Promise<void> {
  const config = await loadUserConfig();
  note(`${aliasTable(config)}\n${routeTable(config)}`, "Current model settings");

  const providers = detectAuthProviders();
  const providerIssues = routeProviderIssues(config, providers);
  if (providerIssues.length) {
    await providerMismatchWizard(config, providers, providerIssues);
  }

  const editDefaults = await prompt(
    confirm({
      message: "Set default provider/model from the catalog now?",
      initialValue: false
    })
  );
  if (editDefaults) {
    await defaultsWizard(config);
  }

  const editAliases = await prompt(
    confirm({
      message: "Add or edit aliases now?",
      initialValue: false
    })
  );
  if (editAliases) {
    await aliasWizard(config);
  }

  const editRoutes = await prompt(
    confirm({
      message: "Update route targets now?",
      initialValue: false
    })
  );
  if (editRoutes) {
    await routeWizard(config);
  }
}

async function providerMismatchWizard(config: PiSpawnerConfig, providers: string[], providerIssues: string[]): Promise<void> {
  note(
    [
      `Authenticated providers: ${providers.join(", ")}`,
      `Unauthenticated config targets: ${providerIssues.join(", ")}`,
      "Pick one available model to use as the primary alias and default route target."
    ].join("\n"),
    "Provider mismatch"
  );

  const repair = await prompt(
    confirm({
      message: "Repair default routes with an authenticated model now?",
      initialValue: true
    })
  );
  if (!repair) {
    return;
  }

  const picked = await pickModel("Search and select the primary model");
  if (!picked) {
    log.warn("Could not repair routes because no authenticated models were loaded.");
    return;
  }

  const thinking = picked.thinking ? await selectThinking("high") : "off";
  const primaryAlias = {
    provider: picked.provider,
    model: picked.model,
    thinking
  };
  config.defaults = { ...primaryAlias };
  config.aliases = config.aliases || {};
  config.aliases.primary = primaryAlias;
  config.routes = config.routes || {};
  const routesToRepair = new Set<string>([
    ...STANDARD_ROUTES,
    ...providerIssues
      .map((issue) => issue.split(" -> ")[0])
      .filter((name) => name && name !== "defaults")
  ]);
  for (const route of routesToRepair) {
    config.routes[route] = "primary";
  }
  config.default_route = "code";
  await writeConfig(config);
  log.success(`Saved primary model ${picked.provider}/${picked.model} and updated default routes.`);
}

async function defaultsWizard(config: PiSpawnerConfig): Promise<void> {
  const picked = await pickModel("Search and select a default model");
  if (!picked) {
    log.info("Default model unchanged.");
    return;
  }
  config.defaults = config.defaults || {};
  config.defaults.provider = picked.provider;
  config.defaults.model = picked.model;
  config.defaults.thinking = picked.thinking ? await selectThinking(config.defaults.thinking || "off") : "off";
  await writeConfig(config);
  log.success(`Saved default model ${picked.provider}/${picked.model}.`);
}

async function aliasWizard(config: PiSpawnerConfig): Promise<void> {
  while (true) {
    config.aliases = config.aliases || {};
    const aliasName = await prompt(
      text({
        message: "Alias name",
        placeholder: "kimi",
        validate(value) {
          const raw = value || "";
          if (!raw.trim()) {
            return "Alias name is required.";
          }
          if (/\s/.test(raw)) {
            return "Alias name must not contain spaces.";
          }
          return undefined;
        }
      })
    );
    const existing = config.aliases[aliasName] ? normalizeAlias(config.aliases[aliasName]) : undefined;
    const picked = await pickModel("Search and select a model for this alias");
    const provider = picked?.provider || (await prompt(
      text({
        message: "Provider",
        initialValue: existing?.provider || "",
        placeholder: "openrouter"
      })
    ));
    const model = picked?.model || (await prompt(
      text({
        message: "Model",
        initialValue: existing?.model || "",
        placeholder: "anthropic/claude-sonnet-4.5",
        validate(value) {
          if (!(value || "").trim()) {
            return "Model is required.";
          }
          return undefined;
        }
      })
    ));

    let thinking: ThinkingLevel | null = existing?.thinking || null;
    if (picked && !picked.thinking) {
      thinking = "off";
      log.info("Selected model does not advertise thinking support; thinking is set to off.");
    } else {
      thinking = await selectThinking(thinking || "off");
    }

    config.aliases[aliasName.trim()] = {
      provider: provider.trim() || null,
      model: model.trim(),
      thinking
    };
    await writeConfig(config);
    log.success(`Saved alias ${aliasName.trim()}.`);

    const another = await prompt(
      confirm({
        message: "Add or edit another alias?",
        initialValue: false
      })
    );
    if (!another) {
      return;
    }
  }
}

async function routeWizard(config: PiSpawnerConfig): Promise<void> {
  while (true) {
    config.routes = config.routes || {};
    const routeChoice = await prompt(
      select<RouteChoice>({
        message: "Route to update",
        options: [
          { value: "code", label: "code", hint: "implementation tasks" },
          { value: "plan", label: "plan", hint: "planning tasks" },
          { value: "writing", label: "writing", hint: "writing and docs" },
          { value: "review", label: "review", hint: "review and critique" },
          { value: "design", label: "design", hint: "visual/product design" },
          { value: "custom", label: "custom route" }
        ],
        initialValue: "code"
      })
    );
    const route = routeChoice === "custom"
      ? await prompt(
        text({
          message: "Custom route name",
          validate(value) {
            if (!(value || "").trim()) {
              return "Route name is required.";
            }
            return undefined;
          }
        })
      )
      : routeChoice;

    const target = await pickRouteTarget(config);
    config.routes[route.trim()] = target;
    await writeConfig(config);
    log.success(`Saved route ${route.trim()} -> ${target}.`);

    const setDefault = await prompt(
      confirm({
        message: "Make this the default route?",
        initialValue: config.default_route === route.trim()
      })
    );
    if (setDefault) {
      config.default_route = route.trim();
      await writeConfig(config);
      log.success(`Saved default route ${route.trim()}.`);
    }

    const another = await prompt(
      confirm({
        message: "Update another route?",
        initialValue: false
      })
    );
    if (!another) {
      return;
    }
  }
}

async function runtimeStep(): Promise<void> {
  const config = await loadUserConfig();
  const current = config.max_concurrency || 3;
  const update = await prompt(
    confirm({
      message: `Read-only worker parallel limit is ${current}. Change it now?`,
      initialValue: false
    })
  );
  if (!update) {
    return;
  }
  const value = await prompt(
    text({
      message: "Max read-worker concurrency",
      initialValue: String(current),
      validate(raw) {
        const parsed = Number(raw);
        if (!Number.isInteger(parsed) || parsed < 1) {
          return "Use an integer >= 1.";
        }
        return undefined;
      }
    })
  );
  config.max_concurrency = Number(value);
  await writeConfig(config);
  log.success(`Saved max_concurrency ${config.max_concurrency}.`);
}

async function hostInstallStep(): Promise<void> {
  const hosts = await detectHosts();
  note(hostStatusSummary(hosts), "Host adapters");
  const available = hosts.filter((host) => host.available);
  if (!available.length) {
    log.warn("No supported host CLI/app was detected, so host adapter installation was skipped.");
    return;
  }

  const selected = await prompt(
    multiselect<HostId>({
      message: "Select hosts to install or update",
      options: available.map((host) => ({
        value: host.id,
        label: host.label,
        hint: host.installed ? "installed; update" : "available"
      })),
      initialValues: available.filter((host) => !host.installed).map((host) => host.id),
      required: false
    })
  );
  if (!selected.length) {
    log.info("Host adapter installation skipped.");
    return;
  }

  const proceed = await prompt(
    confirm({
      message: `Install adapters for ${selected.map((id) => hostLabel(id)).join(", ")}?`,
      initialValue: true
    })
  );
  if (!proceed) {
    log.info("Host adapter installation skipped.");
    return;
  }

  const s = spinner();
  s.start("Installing selected host adapters");
  const results = await installHosts(selected, { repairBrokenCodexMarketplace: true, updateInstalled: true });
  s.stop("Host adapter installation finished");

  const ok = results.filter((result) => result.ok);
  const failed = results.filter((result) => !result.ok);
  if (ok.length) {
    log.success(`Installed: ${ok.map((result) => result.label).join(", ")}`);
  }
  if (failed.length) {
    log.warn(`Needs attention: ${failed.map((result) => result.label).join(", ")}`);
  }
  note(
    results.map((result) => {
      const status = result.ok ? "ok" : "fail";
      const commandBlock = result.commands.length ? `\n  ${result.commands.join("\n  ")}` : "";
      return `[${status}] ${result.label}\n  ${result.detail}${commandBlock}`;
    }).join("\n\n"),
    "Install results"
  );
}

async function pickRouteTarget(config: PiSpawnerConfig): Promise<string> {
  const aliases = Object.keys(config.aliases || {});
  const manual = "__manual__";
  const value = await prompt(
    select<string>({
      message: "Route target",
      options: [
        ...aliases.map((alias) => ({ value: alias, label: alias, hint: targetHint(config, alias) })),
        { value: manual, label: "Manual target", hint: "type an alias or exact model" }
      ],
      initialValue: aliases[0] || manual
    })
  );
  if (value !== manual) {
    return value;
  }
  return prompt(
    text({
      message: "Alias or exact model target",
      validate(raw) {
        if (!(raw || "").trim()) {
          return "Target is required.";
        }
        return undefined;
      }
    })
  );
}

async function pickModel(message: string): Promise<ModelInfo | null> {
  const models = await loadAuthenticatedModels();
  if (!models.length) {
    log.warn("No authenticated provider models were available. Use manual provider/model entry.");
    return null;
  }
  try {
    return await searchPrompt<ModelInfo>(
      {
        message,
        pageSize: 10,
        source(term) {
          return filterModels(models, term).slice(0, 100).map((model) => ({
            value: model,
            name: `${model.model} [${model.provider}]`,
            description: `thinking:${model.thinking ? "yes" : "no"} images:${model.images ? "yes" : "no"} context:${model.context} max:${model.maxOut}`
          }));
        }
      },
      { input, output }
    );
  } catch (error) {
    if (isInquirerCancel(error)) {
      throw new TuiCancelled();
    }
    throw error;
  }
}

async function loadAuthenticatedModels(): Promise<ModelInfo[]> {
  const providers = detectAuthProviders();
  if (!providers.length) {
    return [];
  }
  const s = spinner();
  s.start(`Loading model catalog for ${providers.join(", ")}`);
  const results = await Promise.all(providers.map((provider) => listModels(provider, 30000)));
  const models = uniqueModels(results.flatMap((result) => result.ok ? result.models : []));
  s.stop(models.length ? `Loaded ${models.length} model entries` : "No model entries loaded");
  const providerSet = new Set(providers);
  return models.filter((model) => providerSet.has(model.provider));
}

export function filterModels(models: ModelInfo[], term: string | undefined): ModelInfo[] {
  const normalized = (term || "").trim().toLowerCase();
  if (!normalized) {
    return [...models].sort(modelSort);
  }
  const tokens = normalized.split(/\s+/).filter(Boolean);
  return models
    .map((model) => ({ model, score: modelScore(model, tokens) }))
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score || modelSort(left.model, right.model))
    .map((item) => item.model);
}

function modelScore(model: ModelInfo, tokens: string[]): number {
  const haystack = `${model.provider}/${model.model}`.toLowerCase();
  let score = 0;
  for (const token of tokens) {
    if (haystack === token) {
      score += 100;
    } else if (haystack.startsWith(token)) {
      score += 40;
    } else if (model.model.toLowerCase().startsWith(token)) {
      score += 35;
    } else if (haystack.includes(token)) {
      score += 10;
    } else {
      return 0;
    }
  }
  return score;
}

function modelSort(left: ModelInfo, right: ModelInfo): number {
  return left.provider.localeCompare(right.provider) || left.model.localeCompare(right.model);
}

function uniqueModels(models: ModelInfo[]): ModelInfo[] {
  const seen = new Set<string>();
  const outputModels: ModelInfo[] = [];
  for (const model of models) {
    const key = `${model.provider}\0${model.model}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    outputModels.push(model);
  }
  return outputModels;
}

async function selectThinking(initial: ThinkingLevel): Promise<ThinkingLevel> {
  const value = await prompt(
    select<ThinkingLevel>({
      message: "Thinking level",
      options: THINKING_LEVELS.map((level) => ({ value: level, label: level })),
      initialValue: initial
    })
  );
  return isThinkingLevel(value) ? value : "off";
}

function doctorSummary(report: Awaited<ReturnType<typeof runDoctor>>): string {
  const checks = report.checks.map((check) => {
    const status = check.status === "ok" ? "ok" : check.status === "warn" ? "warn" : "fail";
    const action = check.action ? `\n  Next: ${check.action}` : "";
    return `[${status}] ${check.title}\n  ${check.detail}${action}`;
  });
  checks.push("");
  checks.push(report.ok ? "Ready: pi-spawner can manage settings and delegate tasks." : "Not ready: failed checks can be fixed while setup continues.");
  checks.push(`Config: ${userConfigPath()}`);
  return checks.join("\n");
}

function hostStatusSummary(hosts: Awaited<ReturnType<typeof detectHosts>>): string {
  return hosts.map((host) => {
    const status = host.available ? host.installed ? "installed" : "available" : "missing";
    return `[${status}] ${host.label}\n  ${host.detail}`;
  }).join("\n\n");
}

function aliasTable(config: PiSpawnerConfig): string {
  const aliases = config.aliases || {};
  const rows = Object.entries(aliases).map(([name, value]) => {
    const alias = normalizeAlias(value);
    return [
      name,
      alias.provider || "",
      alias.model,
      alias.thinking || ""
    ];
  });
  return table(["alias", "provider", "model", "thinking"], rows);
}

function routeTable(config: PiSpawnerConfig): string {
  const routes = config.routes || {};
  const rows = Object.entries(routes).map(([route, target]) => [route, typeof target === "string" ? target : target.model]);
  rows.unshift(["default", config.default_route || ""]);
  return table(["route", "target"], rows);
}

function table(headers: string[], rows: string[][]): string {
  const widths = headers.map((header, column) => {
    const values = rows.map((row) => row[column] || "");
    return Math.min(64, Math.max(header.length, ...values.map((value) => value.length)));
  });
  const renderRow = (row: string[]) => row.map((value, index) => truncate(value || "", widths[index]).padEnd(widths[index])).join("  ");
  const body = rows.length ? rows.map(renderRow).join("\n") : "(empty)";
  return `${renderRow(headers)}\n${widths.map((width) => "-".repeat(width)).join("  ")}\n${body}\n`;
}

function truncate(value: string, width: number): string {
  if (value.length <= width) {
    return value;
  }
  return `${value.slice(0, Math.max(0, width - 1))}.`;
}

function targetHint(config: PiSpawnerConfig, aliasName: string): string | undefined {
  const alias = config.aliases?.[aliasName];
  if (!alias) {
    return undefined;
  }
  return normalizeAlias(alias).model;
}

function hostLabel(id: HostId): string {
  if (id === "claude-code") {
    return "Claude Code";
  }
  return id === "codex" ? "Codex" : id === "cursor" ? "Cursor" : "Hermes Agent";
}

async function prompt<T>(value: Promise<T | symbol>): Promise<T> {
  const resolved = await value;
  if (isCancel(resolved)) {
    throw new TuiCancelled();
  }
  return resolved;
}

function isInquirerCancel(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  return error.name === "ExitPromptError" || error.message.includes("User force closed the prompt");
}
