#!/usr/bin/env node
import { ensureAdapters } from "./adapters.js";
import { ensureUserConfig, isThinkingLevel, loadUserConfig, normalizeAlias, readBundledConfig, writeConfig } from "./config.js";
import { runDelegate } from "./delegate.js";
import { formatDoctorReport, runDoctor } from "./doctor.js";
import { listModels } from "./models.js";
import { userConfigPath } from "./paths.js";
import { runTui } from "./tui.js";

async function main(): Promise<number> {
  const [command, ...args] = process.argv.slice(2);

  if (!command || command === "tui") {
    await runTui();
    return 0;
  }

  if (command === "--help" || command === "-h" || command === "help") {
    printHelp();
    return 0;
  }

  if (command === "doctor") {
    const report = await runDoctor({ skipModelList: args.includes("--skip-model-list") });
    if (args.includes("--json")) {
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    } else {
      process.stdout.write(`${formatDoctorReport(report)}\n`);
    }
    return report.ok ? 0 : 1;
  }

  if (command === "delegate") {
    return runDelegate(args);
  }

  if (command === "hosts") {
    const guide = await ensureAdapters();
    process.stdout.write(`${args.includes("--json") ? JSON.stringify(guide, null, 2) : guide.text}\n`);
    return 0;
  }

  if (command === "models") {
    const json = args.includes("--json");
    const search = args.filter((arg) => arg !== "--json").join(" ");
    const result = await listModels(search);
    if (json) {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    } else if (result.ok) {
      for (const model of result.models) {
        process.stdout.write(`${model.provider}\t${model.model}\tthinking:${model.thinking ? "yes" : "no"}\timages:${model.images ? "yes" : "no"}\n`);
      }
    } else {
      process.stderr.write(`${result.error || result.stderr || "Could not list models"}\n`);
    }
    return result.ok ? 0 : 1;
  }

  if (command === "config") {
    return configCommand(args);
  }

  if (command === "aliases" || command === "alias") {
    return aliasesCommand(args);
  }

  if (command === "routes" || command === "route") {
    return routesCommand(args);
  }

  process.stderr.write(`Unknown command: ${command}\n\n`);
  printHelp();
  return 2;
}

async function configCommand(args: string[]): Promise<number> {
  const subcommand = args[0] || "path";
  if (subcommand === "path") {
    process.stdout.write(`${userConfigPath()}\n`);
    return 0;
  }
  if (subcommand === "init") {
    const reset = args.includes("--reset");
    if (reset) {
      await writeConfig(await readBundledConfig());
    } else {
      await ensureUserConfig();
    }
    process.stdout.write(`Config ready at ${userConfigPath()}\n`);
    return 0;
  }
  if (subcommand === "set") {
    const key = args[1];
    const value = args[2];
    if (key !== "max_concurrency" || !value) {
      process.stderr.write("Usage: pi-spawner config set max_concurrency <integer >= 1>\n");
      return 2;
    }
    const maxConcurrency = Number(value);
    if (!Number.isInteger(maxConcurrency) || maxConcurrency < 1) {
      process.stderr.write("max_concurrency must be an integer >= 1.\n");
      return 2;
    }
    const config = await loadUserConfig();
    config.max_concurrency = maxConcurrency;
    await writeConfig(config);
    process.stdout.write(`Saved max_concurrency ${maxConcurrency}\n`);
    return 0;
  }
  process.stderr.write("Usage: pi-spawner config path | config init [--reset] | config set max_concurrency <integer>\n");
  return 2;
}

async function aliasesCommand(args: string[]): Promise<number> {
  const subcommand = args[0] || "list";
  const config = await loadUserConfig();
  config.aliases = config.aliases || {};

  if (subcommand === "list") {
    for (const [name, value] of Object.entries(config.aliases)) {
      const alias = normalizeAlias(value);
      process.stdout.write(`${name}\t${alias.provider || ""}\t${alias.model}\t${alias.thinking || ""}\n`);
    }
    return 0;
  }

  if (subcommand === "set") {
    const name = args[1];
    const provider = valueAfter(args, "--provider");
    const model = valueAfter(args, "--model");
    const thinking = valueAfter(args, "--thinking") || null;
    if (!name || !model) {
      process.stderr.write("Usage: pi-spawner aliases set <name> --provider <provider> --model <model> [--thinking off|minimal|low|medium|high|xhigh]\n");
      return 2;
    }
    if (thinking && !isThinkingLevel(thinking)) {
      process.stderr.write("Invalid thinking level. Use one of: off, minimal, low, medium, high, xhigh.\n");
      return 2;
    }
    const thinkingLevel = thinking && isThinkingLevel(thinking) ? thinking : null;
    config.aliases[name] = { provider: provider || null, model, thinking: thinkingLevel };
    await writeConfig(config);
    process.stdout.write(`Saved alias ${name}\n`);
    return 0;
  }

  if (subcommand === "remove" || subcommand === "rm") {
    const name = args[1];
    if (!name) {
      process.stderr.write("Usage: pi-spawner aliases remove <name>\n");
      return 2;
    }
    delete config.aliases[name];
    await writeConfig(config);
    process.stdout.write(`Removed alias ${name}\n`);
    return 0;
  }

  process.stderr.write("Usage: pi-spawner aliases list | set | remove\n");
  return 2;
}

async function routesCommand(args: string[]): Promise<number> {
  const subcommand = args[0] || "list";
  const config = await loadUserConfig();
  config.routes = config.routes || {};

  if (subcommand === "list") {
    process.stdout.write(`default\t${config.default_route || ""}\n`);
    for (const [name, target] of Object.entries(config.routes)) {
      process.stdout.write(`${name}\t${typeof target === "string" ? target : target.model}\n`);
    }
    return 0;
  }

  if (subcommand === "set") {
    const name = args[1];
    const target = args[2];
    if (!name || !target) {
      process.stderr.write("Usage: pi-spawner routes set <route> <alias-or-model>\n");
      return 2;
    }
    config.routes[name] = target;
    await writeConfig(config);
    process.stdout.write(`Saved route ${name} -> ${target}\n`);
    return 0;
  }

  if (subcommand === "default") {
    const route = args[1];
    if (!route) {
      process.stderr.write("Usage: pi-spawner routes default <route>\n");
      return 2;
    }
    config.default_route = route;
    await writeConfig(config);
    process.stdout.write(`Saved default route ${route}\n`);
    return 0;
  }

  process.stderr.write("Usage: pi-spawner routes list | set | default\n");
  return 2;
}

function valueAfter(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  if (index === -1) {
    return undefined;
  }
  return args[index + 1];
}

function printHelp(): void {
  process.stdout.write(`pi-spawner

Usage:
  pi-spawner                         Open the TUI settings manager
  pi-spawner doctor [--json]          Check Pi/Python/provider/model readiness
  pi-spawner delegate [--dry-run]     Run the delegation JSON API through the global CLI
  pi-spawner hosts                    Generate Codex/Claude Code/Cursor adapters
  pi-spawner models [search]          List models from pi --list-models
  pi-spawner config path              Print active config path
  pi-spawner config init [--reset]    Create or reset ~/.pi/pi-spawner/models.json
  pi-spawner config set max_concurrency <n>
  pi-spawner aliases list             Show configured aliases
  pi-spawner aliases set <name> --provider <provider> --model <model> [--thinking level]
  pi-spawner routes list              Show configured routes
  pi-spawner routes set <route> <target>
`);
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (error) => {
    process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`);
    process.exitCode = 1;
  }
);
