import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname } from "node:path";
import { bundledConfigPath, userConfigPath } from "./paths.js";
import { AliasConfig, PiSpawnerConfig, THINKING_LEVELS, ThinkingLevel } from "./types.js";

const FALLBACK_CONFIG: PiSpawnerConfig = {
  default_route: "code",
  max_concurrency: 3,
  defaults: {
    provider: null,
    model: null,
    thinking: null
  },
  aliases: {
    kimi: {
      provider: "openrouter",
      model: "moonshotai/kimi-k2.6",
      thinking: "high"
    },
    "kimi-k2": {
      provider: "openrouter",
      model: "moonshotai/kimi-k2.6",
      thinking: "high"
    },
    deepseek: {
      provider: "openrouter",
      model: "deepseek/deepseek-v3.2",
      thinking: "high"
    },
    qwen: {
      provider: "openrouter",
      model: "qwen/qwen3-coder",
      thinking: "off"
    },
    gemini: {
      provider: "openrouter",
      model: "google/gemini-2.5-pro",
      thinking: "high"
    }
  },
  routes: {
    code: "kimi",
    plan: "kimi",
    writing: "deepseek",
    review: "deepseek",
    design: "gemini"
  }
};

export function isThinkingLevel(value: unknown): value is ThinkingLevel {
  return typeof value === "string" && THINKING_LEVELS.includes(value as ThinkingLevel);
}

export async function readJsonFile(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, "utf8"));
}

export async function readBundledConfig(): Promise<PiSpawnerConfig> {
  try {
    const value = await readJsonFile(bundledConfigPath());
    const validated = validateConfig(value);
    if (!validated.ok) {
      return structuredClone(FALLBACK_CONFIG);
    }
    return validated.config;
  } catch {
    return structuredClone(FALLBACK_CONFIG);
  }
}

export async function ensureUserConfig(): Promise<string> {
  const path = userConfigPath();
  if (existsSync(path)) {
    return path;
  }
  await mkdir(dirname(path), { recursive: true });
  await writeConfig(await readBundledConfig(), path);
  return path;
}

export async function loadUserConfig(): Promise<PiSpawnerConfig> {
  const path = await ensureUserConfig();
  const value = await readJsonFile(path);
  const validated = validateConfig(value);
  if (!validated.ok) {
    throw new Error(`Invalid config at ${path}: ${validated.errors.join("; ")}`);
  }
  return validated.config;
}

export async function writeConfig(config: PiSpawnerConfig, path = userConfigPath()): Promise<void> {
  const validated = validateConfig(config);
  if (!validated.ok) {
    throw new Error(`Invalid config: ${validated.errors.join("; ")}`);
  }
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(validated.config, null, 2)}\n`, "utf8");
}

export function validateConfig(value: unknown): { ok: true; config: PiSpawnerConfig } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!isRecord(value)) {
    return { ok: false, errors: ["top-level config must be an object"] };
  }

  const config: PiSpawnerConfig = {};
  if ("default_route" in value) {
    config.default_route = nullableString(value.default_route, "default_route", errors);
  }
  if ("max_concurrency" in value) {
    config.max_concurrency = nullablePositiveInteger(value.max_concurrency, "max_concurrency", errors);
  }

  if ("defaults" in value) {
    if (!isRecord(value.defaults)) {
      errors.push("defaults must be an object");
    } else {
      config.defaults = {};
      if ("provider" in value.defaults) {
        config.defaults.provider = nullableString(value.defaults.provider, "defaults.provider", errors);
      }
      if ("model" in value.defaults) {
        config.defaults.model = nullableString(value.defaults.model, "defaults.model", errors);
      }
      if ("thinking" in value.defaults) {
        config.defaults.thinking = nullableThinking(value.defaults.thinking, "defaults.thinking", errors);
      }
    }
  }

  if ("aliases" in value) {
    config.aliases = validateMap(value.aliases, "aliases", errors);
  }
  if ("routes" in value) {
    config.routes = validateMap(value.routes, "routes", errors);
  }

  return errors.length ? { ok: false, errors } : { ok: true, config };
}

export function normalizeAlias(value: AliasConfig | string): AliasConfig {
  if (typeof value === "string") {
    return { model: value };
  }
  return value;
}

function validateMap(value: unknown, name: string, errors: string[]): Record<string, AliasConfig | string> {
  const output: Record<string, AliasConfig | string> = {};
  if (!isRecord(value)) {
    errors.push(`${name} must be an object`);
    return output;
  }
  for (const [key, item] of Object.entries(value)) {
    if (!key.trim()) {
      errors.push(`${name} contains an empty key`);
      continue;
    }
    if (typeof item === "string") {
      if (!item.trim()) {
        errors.push(`${name}.${key} must not be empty`);
      } else {
        output[key] = item.trim();
      }
      continue;
    }
    if (!isRecord(item)) {
      errors.push(`${name}.${key} must be a string or object`);
      continue;
    }
    const entry: AliasConfig = {
      model: nullableString(item.model, `${name}.${key}.model`, errors) || ""
    };
    if (!entry.model) {
      errors.push(`${name}.${key}.model is required`);
    }
    if ("provider" in item) {
      entry.provider = nullableString(item.provider, `${name}.${key}.provider`, errors);
    }
    if ("thinking" in item) {
      entry.thinking = nullableThinking(item.thinking, `${name}.${key}.thinking`, errors);
    }
    output[key] = entry;
  }
  return output;
}

function nullableString(value: unknown, name: string, errors: string[]): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value !== "string") {
    errors.push(`${name} must be a string or null`);
    return null;
  }
  return value.trim() || null;
}

function nullableThinking(value: unknown, name: string, errors: string[]): ThinkingLevel | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  if (!isThinkingLevel(value)) {
    errors.push(`${name} must be one of ${THINKING_LEVELS.join(", ")}`);
    return null;
  }
  return value;
}

function nullablePositiveInteger(value: unknown, name: string, errors: string[]): number | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    errors.push(`${name} must be an integer >= 1`);
    return null;
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
