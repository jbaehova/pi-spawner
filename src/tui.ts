import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { ensureAdapters } from "./adapters.js";
import { ensureUserConfig, isThinkingLevel, loadUserConfig, normalizeAlias, writeConfig } from "./config.js";
import { detectAuthProviders, formatDoctorReport, runDoctor } from "./doctor.js";
import { listModels } from "./models.js";
import { userConfigPath } from "./paths.js";
import { ModelInfo, PiSpawnerConfig, THINKING_LEVELS, ThinkingLevel } from "./types.js";

type Interface = readline.Interface;

export async function runTui(): Promise<void> {
  await ensureUserConfig();
  if (!input.isTTY) {
    output.write("Pi Spawner TUI requires an interactive terminal.\n");
    output.write("Use `pi-spawner doctor`, `pi-spawner config`, `pi-spawner aliases`, or `pi-spawner routes` for non-interactive automation.\n");
    return;
  }

  const rl = readline.createInterface({ input, output });
  try {
    const report = await runDoctor();
    clearScreen();
    printTitle();
    output.write(`${formatDoctorReport(report)}\n\n`);
    if (!report.ok) {
      const answer = await ask(rl, "Some setup is missing. Press Enter to continue settings anyway, or type q to quit");
      if (answer.toLowerCase() === "q") {
        return;
      }
    } else {
      await pause(rl);
    }

    while (true) {
      clearScreen();
      printTitle();
      output.write(`Config: ${userConfigPath()}\n\n`);
      output.write("1. Doctor\n");
      output.write("2. Aliases\n");
      output.write("3. Routes\n");
      output.write("4. Runtime settings\n");
      output.write("5. Model picker\n");
      output.write("6. Host adapters\n");
      output.write("q. Quit\n\n");
      const choice = (await ask(rl, "Choose")).toLowerCase();
      if (choice === "q") {
        return;
      }
      if (choice === "1") {
        await showDoctor(rl);
      } else if (choice === "2") {
        await aliasMenu(rl);
      } else if (choice === "3") {
        await routeMenu(rl);
      } else if (choice === "4") {
        await runtimeMenu(rl);
      } else if (choice === "5") {
        await pickerMenu(rl);
      } else if (choice === "6") {
        await hostMenu(rl);
      }
    }
  } finally {
    rl.close();
  }
}

async function showDoctor(rl: Interface): Promise<void> {
  clearScreen();
  printTitle();
  output.write(`${formatDoctorReport(await runDoctor())}\n\n`);
  await pause(rl);
}

async function aliasMenu(rl: Interface): Promise<void> {
  while (true) {
    const config = await loadUserConfig();
    clearScreen();
    printTitle();
    output.write("Aliases\n\n");
    output.write(aliasTable(config));
    output.write("\n");
    output.write("1. Add or edit alias\n");
    output.write("2. Remove alias\n");
    output.write("b. Back\n\n");
    const choice = (await ask(rl, "Choose")).toLowerCase();
    if (choice === "b") {
      return;
    }
    if (choice === "1") {
      await upsertAlias(rl, config);
    } else if (choice === "2") {
      await removeAlias(rl, config);
    }
  }
}

async function routeMenu(rl: Interface): Promise<void> {
  while (true) {
    const config = await loadUserConfig();
    clearScreen();
    printTitle();
    output.write("Routes\n\n");
    output.write(routeTable(config));
    output.write("\n");
    output.write("1. Set route target\n");
    output.write("2. Set default route\n");
    output.write("b. Back\n\n");
    const choice = (await ask(rl, "Choose")).toLowerCase();
    if (choice === "b") {
      return;
    }
    if (choice === "1") {
      await setRoute(rl, config);
    } else if (choice === "2") {
      await setDefaultRoute(rl, config);
    }
  }
}

async function runtimeMenu(rl: Interface): Promise<void> {
  const config = await loadUserConfig();
  clearScreen();
  printTitle();
  output.write("Runtime settings\n\n");
  output.write(`Max read-worker concurrency: ${config.max_concurrency || 3}\n`);
  output.write("Write-enabled tasks still run sequentially so file changes can be attributed.\n\n");
  const answer = await ask(rl, "New max_concurrency", String(config.max_concurrency || 3));
  const maxConcurrency = Number(answer);
  if (!Number.isInteger(maxConcurrency) || maxConcurrency < 1) {
    output.write("max_concurrency must be an integer >= 1.\n");
    await pause(rl);
    return;
  }
  config.max_concurrency = maxConcurrency;
  await writeConfig(config);
  output.write(`Saved max_concurrency ${maxConcurrency}.\n`);
  await pause(rl);
}

async function pickerMenu(rl: Interface): Promise<void> {
  clearScreen();
  printTitle();
  output.write("Model picker\n\n");
  const picked = await pickModel(rl);
  if (!picked) {
    return;
  }
  output.write("\nSelected:\n");
  output.write(`  provider: ${picked.provider}\n`);
  output.write(`  model: ${picked.model}\n`);
  output.write(`  thinking support: ${picked.thinking ? "yes" : "no"}\n\n`);
  await pause(rl);
}

async function hostMenu(rl: Interface): Promise<void> {
  clearScreen();
  printTitle();
  const guide = await ensureAdapters();
  output.write(`${guide.text}\n`);
  await pause(rl);
}

async function upsertAlias(rl: Interface, config: PiSpawnerConfig): Promise<void> {
  const aliases = config.aliases || {};
  const name = await ask(rl, "Alias name");
  if (!name.trim()) {
    return;
  }
  const existing = aliases[name.trim()] ? normalizeAlias(aliases[name.trim()]) : undefined;
  output.write("\nPick a model from Pi, or leave search empty and choose manual entry.\n");
  const picked = await pickModel(rl);
  const provider = picked?.provider || (await ask(rl, "Provider", existing?.provider || ""));
  const model = picked?.model || (await ask(rl, "Model", existing?.model || ""));
  if (!model.trim()) {
    output.write("Model is required.\n");
    await pause(rl);
    return;
  }

  let thinking: ThinkingLevel | null = existing?.thinking || null;
  if (picked && !picked.thinking) {
    thinking = "off";
    output.write("Selected model does not advertise thinking support; thinking set to off.\n");
  } else {
    const answer = await ask(rl, `Thinking (${THINKING_LEVELS.join("/")})`, thinking || "off");
    thinking = isThinkingLevel(answer) ? answer : "off";
  }

  aliases[name.trim()] = {
    provider: provider.trim() || null,
    model: model.trim(),
    thinking
  };
  config.aliases = aliases;
  await writeConfig(config);
  output.write(`Saved alias ${name.trim()}.\n`);
  await pause(rl);
}

async function removeAlias(rl: Interface, config: PiSpawnerConfig): Promise<void> {
  const name = await ask(rl, "Alias to remove");
  if (!name.trim() || !config.aliases?.[name.trim()]) {
    return;
  }
  delete config.aliases[name.trim()];
  await writeConfig(config);
  output.write(`Removed alias ${name.trim()}.\n`);
  await pause(rl);
}

async function setRoute(rl: Interface, config: PiSpawnerConfig): Promise<void> {
  const route = await ask(rl, "Route name", config.default_route || "code");
  if (!route.trim()) {
    return;
  }
  const target = await ask(rl, "Alias or model target", config.routes?.[route.trim()] ? targetLabel(config.routes[route.trim()]) : "");
  if (!target.trim()) {
    return;
  }
  config.routes = config.routes || {};
  config.routes[route.trim()] = target.trim();
  await writeConfig(config);
  output.write(`Saved route ${route.trim()} -> ${target.trim()}.\n`);
  await pause(rl);
}

async function setDefaultRoute(rl: Interface, config: PiSpawnerConfig): Promise<void> {
  const route = await ask(rl, "Default route", config.default_route || "code");
  if (!route.trim()) {
    return;
  }
  config.default_route = route.trim();
  await writeConfig(config);
  output.write(`Saved default route ${route.trim()}.\n`);
  await pause(rl);
}

async function pickModel(rl: Interface): Promise<ModelInfo | null> {
  const providers = detectAuthProviders();
  if (!providers.length) {
    output.write("No authenticated provider was detected. Run Pi provider setup first, then rerun `pi-spawner doctor`.\n");
    await pause(rl);
    return null;
  }

  const search = await ask(rl, "Search provider/model", providers[0]);
  const result = await listModels(search || providers[0]);
  if (!result.ok) {
    output.write(`Could not load model list: ${result.error || result.stderr || "unknown error"}\n`);
    output.write(`Run \`pi --list-models ${search || providers[0]}\` directly to debug Pi-side setup.\n`);
    await pause(rl);
    return null;
  }

  const providerSet = new Set(providers);
  const models = result.models.filter((model) => providerSet.has(model.provider));
  const visible = (models.length ? models : result.models).slice(0, 30);
  if (!visible.length) {
    output.write("No models matched that search.\n");
    await pause(rl);
    return null;
  }

  output.write("\n");
  visible.forEach((model, index) => {
    output.write(`${String(index + 1).padStart(2, " ")}. ${model.provider.padEnd(12)} ${truncate(model.model, 58).padEnd(58)} thinking:${model.thinking ? "yes" : "no"} images:${model.images ? "yes" : "no"}\n`);
  });
  output.write("\n");
  const choice = await ask(rl, "Model number, or empty to cancel");
  const index = Number(choice);
  if (!Number.isInteger(index) || index < 1 || index > visible.length) {
    return null;
  }
  return visible[index - 1];
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

function targetLabel(target: NonNullable<PiSpawnerConfig["routes"]>[string]): string {
  return typeof target === "string" ? target : target.model;
}

function table(headers: string[], rows: string[][]): string {
  const widths = headers.map((header, column) => {
    const values = rows.map((row) => row[column] || "");
    return Math.min(64, Math.max(header.length, ...values.map((value) => value.length)));
  });
  const renderRow = (row: string[]) => row.map((value, index) => truncate(value || "", widths[index]).padEnd(widths[index])).join("  ");
  return `${renderRow(headers)}\n${widths.map((width) => "-".repeat(width)).join("  ")}\n${rows.map(renderRow).join("\n")}\n`;
}

function truncate(value: string, width: number): string {
  if (value.length <= width) {
    return value;
  }
  return `${value.slice(0, Math.max(0, width - 1))}.`;
}

function printTitle(): void {
  output.write("Pi Spawner Settings\n");
  output.write("===================\n\n");
}

function clearScreen(): void {
  if (output.isTTY) {
    output.write("\x1Bc");
  }
}

async function ask(rl: Interface, question: string, defaultValue = ""): Promise<string> {
  const suffix = defaultValue ? ` [${defaultValue}]` : "";
  const answer = await rl.question(`${question}${suffix}: `);
  return answer.trim() || defaultValue;
}

async function pause(rl: Interface): Promise<void> {
  await rl.question("Press Enter to continue...");
}
