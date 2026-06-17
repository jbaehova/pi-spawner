import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { modelCachePath } from "./paths.js";
import { ModelInfo } from "./types.js";

export interface ListModelsResult {
  ok: boolean;
  models: ModelInfo[];
  stdout: string;
  stderr: string;
  exitCode: number | null;
  error?: string;
}

export function parseModelTable(output: string): ModelInfo[] {
  const models: ModelInfo[] = [];
  for (const line of output.split(/\r?\n/)) {
    const trimmed = line.trimEnd();
    if (!trimmed || trimmed.startsWith("provider ") || /^-+$/.test(trimmed)) {
      continue;
    }

    const match = /^(\S+)\s+(.+?)\s+(\S+)\s+(\S+)\s+(yes|no)\s+(yes|no)\s*$/.exec(trimmed);
    if (!match) {
      continue;
    }

    models.push({
      provider: match[1],
      model: match[2].trim(),
      context: match[3],
      maxOut: match[4],
      thinking: match[5] === "yes",
      images: match[6] === "yes"
    });
  }
  return models;
}

export async function listModels(search = "", timeoutMs = 15000): Promise<ListModelsResult> {
  const args = ["--list-models"];
  if (search.trim()) {
    args.push(search.trim());
  }

  const result = await runPi(args, timeoutMs);
  const models = parseModelTable(result.stdout);
  if (result.exitCode === 0) {
    await writeModelCache(search, models).catch(() => undefined);
  }
  return {
    ok: result.exitCode === 0,
    models,
    stdout: result.stdout,
    stderr: result.stderr,
    exitCode: result.exitCode,
    error: result.error
  };
}

async function runPi(args: string[], timeoutMs: number): Promise<{ stdout: string; stderr: string; exitCode: number | null; error?: string }> {
  return new Promise((resolve) => {
    const child = spawn("pi", args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      child.kill("SIGTERM");
      resolve({
        stdout,
        stderr,
        exitCode: null,
        error: `timed out after ${timeoutMs}ms`
      });
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
      resolve({
        stdout,
        stderr,
        exitCode: error.code === "ENOENT" ? 127 : null,
        error: error.message
      });
    });
    child.on("close", (code) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolve({ stdout, stderr, exitCode: code });
    });
  });
}

async function writeModelCache(search: string, models: ModelInfo[]): Promise<void> {
  const path = modelCachePath();
  await mkdir(dirname(path), { recursive: true });
  await writeFile(
    path,
    `${JSON.stringify({ generated_at: new Date().toISOString(), search, models }, null, 2)}\n`,
    "utf8"
  );
}
