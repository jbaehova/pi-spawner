import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { validateConfig } from "./config.js";
import { listModels } from "./models.js";
import { piAgentDir, userConfigPath } from "./paths.js";
import { DoctorCheck, DoctorReport } from "./types.js";

export const PROVIDER_AUTH_HINTS: Record<string, string[]> = {
  anthropic: ["ANTHROPIC_API_KEY", "ANTHROPIC_OAUTH_TOKEN"],
  azure: ["AZURE_OPENAI_API_KEY", "AZURE_OPENAI_BASE_URL"],
  cerebras: ["CEREBRAS_API_KEY"],
  cloudflare: ["CLOUDFLARE_API_KEY", "CLOUDFLARE_ACCOUNT_ID"],
  deepseek: ["DEEPSEEK_API_KEY"],
  fireworks: ["FIREWORKS_API_KEY"],
  google: ["GEMINI_API_KEY"],
  groq: ["GROQ_API_KEY"],
  kimi: ["KIMI_API_KEY"],
  mistral: ["MISTRAL_API_KEY"],
  moonshot: ["MOONSHOT_API_KEY"],
  nvidia: ["NVIDIA_API_KEY"],
  openai: ["OPENAI_API_KEY"],
  openrouter: ["OPENROUTER_API_KEY"],
  together: ["TOGETHER_API_KEY"],
  xai: ["XAI_API_KEY"],
  zai: ["ZAI_API_KEY"]
};

export async function runDoctor(options: { skipModelList?: boolean } = {}): Promise<DoctorReport> {
  const checks: DoctorCheck[] = [];
  const pi = commandVersion("pi", ["--version"]);
  checks.push(
    pi.ok
      ? {
          id: "pi",
          title: "Pi CLI",
          status: "ok",
          detail: `Found pi ${pi.output || ""}`.trim()
        }
      : {
          id: "pi",
          title: "Pi CLI",
          status: "fail",
          detail: "The pi executable is not available on PATH.",
          action: "Install Pi CLI, open a new terminal, and confirm `pi --version` works before returning."
        }
  );

  const pythonBinary = process.env.PI_SPAWNER_PYTHON || "python3";
  const python = commandVersion(pythonBinary, ["--version"]);
  const pythonVersion = parsePythonVersion(python.output);
  checks.push(
    python.ok && pythonVersion && isAtLeastPython310(pythonVersion)
      ? {
          id: "python",
          title: "Python runtime",
          status: "ok",
          detail: `Found ${python.output}`
        }
      : {
          id: "python",
          title: "Python runtime",
          status: "fail",
          detail: python.ok
            ? `Found ${python.output || pythonBinary}, but Pi Spawner delegation requires Python 3.10+.`
            : `Could not run ${pythonBinary}.`,
          action: "Install Python 3.10+ or set PI_SPAWNER_PYTHON to a compatible interpreter."
        }
  );

  const providers = detectAuthProviders();
  checks.push(
    providers.length
      ? {
          id: "providers",
          title: "Provider auth",
          status: "ok",
          detail: `Detected provider credentials for: ${providers.join(", ")}`
        }
      : {
          id: "providers",
          title: "Provider auth",
          status: "fail",
          detail: "No Pi provider credentials were detected in ~/.pi/agent/auth.json or supported environment variables.",
          action: "Configure a provider in Pi first, then rerun `pi-spawner doctor`. For example, complete the Pi CLI login/API-key flow for OpenRouter, OpenAI, Anthropic, or your chosen provider."
        }
  );

  checks.push(configCheck());

  let modelCount = 0;
  if (options.skipModelList) {
    checks.push({
      id: "models",
      title: "Model catalog",
      status: "warn",
      detail: "Skipped model catalog check."
    });
  } else if (!pi.ok) {
    checks.push({
      id: "models",
      title: "Model catalog",
      status: "fail",
      detail: "Skipped because Pi CLI is not available.",
      action: "Fix the Pi CLI installation first, then rerun `pi-spawner doctor`."
    });
  } else if (!providers.length) {
    checks.push({
      id: "models",
      title: "Model catalog",
      status: "fail",
      detail: "Skipped because no authenticated provider was detected.",
      action: "Configure provider auth in Pi, then rerun `pi-spawner doctor`."
    });
  } else {
    const result = await listModels(providers[0], 15000);
    const providerSet = new Set(providers);
    const providerModels = result.models.filter((model) => providerSet.has(model.provider));
    modelCount = providerModels.length || result.models.length;
    checks.push(
      result.ok && modelCount > 0
        ? {
            id: "models",
            title: "Model catalog",
            status: "ok",
            detail: `Loaded ${modelCount} model entries from \`pi --list-models ${providers[0]}\`.`
          }
        : {
            id: "models",
            title: "Model catalog",
            status: "fail",
            detail: result.error || result.stderr.trim() || "Pi returned no usable model catalog rows.",
            action: `Run \`pi --list-models ${providers[0]}\` directly and fix the Pi-side provider/model issue first.`
          }
    );
  }

  return {
    ok: !checks.some((check) => check.status === "fail"),
    checks,
    providers,
    modelCount,
    configPath: userConfigPath()
  };
}

export function formatDoctorReport(report: DoctorReport): string {
  const lines = [
    "Pi Spawner Doctor",
    `Config: ${report.configPath}`,
    ""
  ];

  for (const check of report.checks) {
    lines.push(`${statusIcon(check.status)} ${check.title}`);
    lines.push(`  ${check.detail}`);
    if (check.action) {
      lines.push(`  Next: ${check.action}`);
    }
    lines.push("");
  }

  lines.push(report.ok ? "Ready: pi-spawner can manage settings and delegate tasks." : "Not ready: finish the failed steps above, then run `pi-spawner doctor` again.");
  return lines.join("\n");
}

export function detectAuthProviders(): string[] {
  const providers = new Set<string>();
  const authPath = join(piAgentDir(), "auth.json");
  if (existsSync(authPath)) {
    try {
      const auth = JSON.parse(readFileSync(authPath, "utf8"));
      for (const provider of extractAuthProviderKeys(auth)) {
        providers.add(provider);
      }
    } catch {
      // The config check reports JSON problems separately. Auth detection stays best-effort.
    }
  }

  for (const [provider, envVars] of Object.entries(PROVIDER_AUTH_HINTS)) {
    if (envVars.some((name) => Boolean(process.env[name]))) {
      providers.add(provider);
    }
  }

  return [...providers].sort();
}

export function extractAuthProviderKeys(value: unknown): string[] {
  const providers = new Set<string>();
  visit(value);
  return [...providers].sort();

  function visit(node: unknown): void {
    if (!node || typeof node !== "object" || Array.isArray(node)) {
      return;
    }
    for (const [key, child] of Object.entries(node)) {
      if (key in PROVIDER_AUTH_HINTS && hasCredentialLikeValue(child)) {
        providers.add(key);
      }
      visit(child);
    }
  }
}

function hasCredentialLikeValue(value: unknown): boolean {
  if (typeof value === "string") {
    return value.trim().length > 0;
  }
  if (typeof value === "object" && value !== null) {
    return Object.values(value).some(hasCredentialLikeValue);
  }
  return Boolean(value);
}

function configCheck(): DoctorCheck {
  const path = userConfigPath();
  if (!existsSync(path)) {
    return {
      id: "config",
      title: "Pi Spawner config",
      status: "warn",
      detail: `No config exists yet at ${path}. The TUI will create it from bundled defaults.`,
      action: "Run `pi-spawner` to open the settings manager, or `pi-spawner config init` to create it now."
    };
  }

  try {
    const validated = validateConfig(JSON.parse(readFileSync(path, "utf8")));
    if (!validated.ok) {
      return {
        id: "config",
        title: "Pi Spawner config",
        status: "fail",
        detail: `Config validation failed: ${validated.errors.join("; ")}`,
        action: "Back up the file, then run `pi-spawner config init --reset` if you want to restore defaults."
      };
    }
    return {
      id: "config",
      title: "Pi Spawner config",
      status: "ok",
      detail: `Loaded ${path}`
    };
  } catch (error) {
    return {
      id: "config",
      title: "Pi Spawner config",
      status: "fail",
      detail: error instanceof Error ? error.message : String(error),
      action: "Fix the JSON syntax, or back up the file and run `pi-spawner config init --reset`."
    };
  }
}

function commandVersion(command: string, args: string[]): { ok: boolean; output: string } {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    timeout: 5000
  });
  return {
    ok: !result.error && result.status === 0,
    output: `${result.stdout || result.stderr || ""}`.trim()
  };
}

function parsePythonVersion(output: string): [number, number, number] | null {
  const match = /Python\s+(\d+)\.(\d+)\.(\d+)/.exec(output || "");
  if (!match) {
    return null;
  }
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function isAtLeastPython310(version: [number, number, number]): boolean {
  return version[0] > 3 || (version[0] === 3 && version[1] >= 10);
}

function statusIcon(status: "ok" | "warn" | "fail"): string {
  if (status === "ok") {
    return "[ok]";
  }
  if (status === "warn") {
    return "[warn]";
  }
  return "[fail]";
}
