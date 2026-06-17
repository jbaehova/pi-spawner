import test from "node:test";
import assert from "node:assert/strict";
import { validateConfig } from "./config.js";

test("validateConfig accepts the supported models.json shape", () => {
  const result = validateConfig({
    default_route: "code",
    max_concurrency: 3,
    defaults: {
      provider: null,
      model: null,
      thinking: "high"
    },
    aliases: {
      kimi: {
        provider: "openrouter",
        model: "moonshotai/kimi-k2.6",
        thinking: "high"
      },
      exact: "openai/gpt-5:medium"
    },
    routes: {
      code: "kimi"
    }
  });

  assert.equal(result.ok, true);
});

test("validateConfig rejects invalid max_concurrency values", () => {
  const result = validateConfig({
    max_concurrency: 0
  });

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.match(result.errors.join("\n"), /max_concurrency/);
  }
});

test("validateConfig rejects invalid thinking values", () => {
  const result = validateConfig({
    aliases: {
      bad: {
        provider: "openrouter",
        model: "model",
        thinking: "maximum"
      }
    }
  });

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.match(result.errors.join("\n"), /thinking/);
  }
});
