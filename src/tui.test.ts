import test from "node:test";
import assert from "node:assert/strict";
import { filterModels } from "./tui.js";
import { ModelInfo } from "./types.js";

test("filterModels searches beyond the old 30 item picker cap", () => {
  const models: ModelInfo[] = Array.from({ length: 68 }, (_, index) => ({
    provider: "openrouter",
    model: `anthropic/claude-test-${String(index + 1).padStart(2, "0")}`,
    context: "200K",
    maxOut: "32K",
    thinking: true,
    images: true
  }));

  const matches = filterModels(models, "anthropic");

  assert.equal(matches.length, 68);
  assert.equal(matches.at(-1)?.model, "anthropic/claude-test-68");
});

test("filterModels requires all query tokens to match", () => {
  const models: ModelInfo[] = [
    {
      provider: "openrouter",
      model: "anthropic/claude-sonnet-4.5",
      context: "200K",
      maxOut: "32K",
      thinking: true,
      images: true
    },
    {
      provider: "openrouter",
      model: "google/gemini-2.5-pro",
      context: "1M",
      maxOut: "64K",
      thinking: true,
      images: true
    }
  ];

  const matches = filterModels(models, "claude sonnet");

  assert.deepEqual(matches.map((model) => model.model), ["anthropic/claude-sonnet-4.5"]);
});
