import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";

export function packageRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "..");
}

export function userRoot(): string {
  return process.env.PI_SPAWNER_HOME || join(homedir(), ".pi", "pi-spawner");
}

export function userConfigPath(): string {
  return process.env.PI_SPAWNER_CONFIG || join(userRoot(), "models.json");
}

export function modelCachePath(): string {
  return join(userRoot(), "model-cache.json");
}

export function adaptersRoot(): string {
  return join(userRoot(), "adapters");
}

export function bundledConfigPath(): string {
  return join(packageRoot(), "skills", "pi-spawner", "models.json");
}

export function bundledDelegatePath(): string {
  return join(packageRoot(), "skills", "pi-spawner", "scripts", "pi_delegate.py");
}

export function piAgentDir(): string {
  return process.env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent");
}
