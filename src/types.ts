export const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh"] as const;

export type ThinkingLevel = (typeof THINKING_LEVELS)[number];

export type Status = "ok" | "warn" | "fail";

export interface AliasConfig {
  provider?: string | null;
  model: string;
  thinking?: ThinkingLevel | null;
}

export interface PiSpawnerConfig {
  default_route?: string | null;
  max_concurrency?: number | null;
  defaults?: {
    provider?: string | null;
    model?: string | null;
    thinking?: ThinkingLevel | null;
  };
  aliases?: Record<string, AliasConfig | string>;
  routes?: Record<string, AliasConfig | string>;
}

export interface ModelInfo {
  provider: string;
  model: string;
  context: string;
  maxOut: string;
  thinking: boolean;
  images: boolean;
}

export interface DoctorCheck {
  id: string;
  title: string;
  status: Status;
  detail: string;
  action?: string;
}

export interface DoctorReport {
  ok: boolean;
  checks: DoctorCheck[];
  providers: string[];
  modelCount: number;
  configPath: string;
}
