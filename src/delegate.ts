import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { ensureUserConfig } from "./config.js";
import { bundledDelegatePath } from "./paths.js";

export async function runDelegate(args: string[]): Promise<number> {
  const dryRun = args.includes("--dry-run");
  const specPath = valueAfter(args, "--spec");
  const rawSpec = specPath ? await readFile(specPath, "utf8") : await readStdin();

  if (!rawSpec.trim()) {
    process.stderr.write("No JSON spec provided on stdin or with --spec.\n");
    return 2;
  }

  let spec: unknown;
  try {
    spec = JSON.parse(rawSpec);
  } catch (error) {
    process.stderr.write(`Invalid JSON spec: ${error instanceof Error ? error.message : String(error)}\n`);
    return 2;
  }

  if (!spec || typeof spec !== "object" || Array.isArray(spec)) {
    process.stderr.write("Top-level spec must be a JSON object.\n");
    return 2;
  }

  const mutableSpec = { ...(spec as Record<string, unknown>) };
  if (!mutableSpec.config_path && !process.env.PI_SPAWNER_CONFIG) {
    mutableSpec.config_path = await ensureUserConfig();
  }

  return spawnPython(JSON.stringify(mutableSpec), dryRun);
}

function spawnPython(specJson: string, dryRun: boolean): Promise<number> {
  return new Promise((resolve) => {
    const python = process.env.PI_SPAWNER_PYTHON || "python3";
    const childArgs = [bundledDelegatePath()];
    if (dryRun) {
      childArgs.push("--dry-run");
    }

    const child = spawn(python, childArgs, {
      stdio: ["pipe", "inherit", "inherit"]
    });

    child.on("error", (error: NodeJS.ErrnoException) => {
      process.stderr.write(`Could not start ${python}: ${error.message}\n`);
      resolve(error.code === "ENOENT" ? 127 : 1);
    });
    child.on("close", (code) => {
      resolve(code ?? 1);
    });
    child.stdin.end(specJson);
  });
}

function valueAfter(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  if (index === -1) {
    return undefined;
  }
  return args[index + 1];
}

function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      data += chunk;
    });
    process.stdin.on("end", () => {
      resolve(data);
    });
    process.stdin.on("error", reject);
    if (process.stdin.isTTY) {
      resolve("");
    }
  });
}
