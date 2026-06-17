import test from "node:test";
import assert from "node:assert/strict";
import { migrateBundledDefaults, routeProviderIssues, validateConfig } from "./config.js";

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
        model: "~moonshotai/kimi-latest",
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

test("migrateBundledDefaults updates only stale bundled aliases and routes", () => {
  const validated = validateConfig({
    default_route: "code",
    max_concurrency: 5,
    aliases: {
      kimi: {
        provider: "openrouter",
        model: "moonshotai/kimi-k2.6",
        thinking: "high"
      },
      deepseek: {
        provider: "openrouter",
        model: "custom/deepseek",
        thinking: "high"
      }
    },
    routes: {
      code: "kimi",
      review: "deepseek"
    }
  });
  assert.equal(validated.ok, true);
  if (!validated.ok) {
    return;
  }
  const result = migrateBundledDefaults(validated.config);

  assert.equal(result.changed, true);
  const aliases = result.config.aliases || {};
  assert.deepEqual(aliases.kimi, {
    provider: "openrouter",
    model: "~moonshotai/kimi-latest",
    thinking: "high"
  });
  assert.deepEqual(aliases.deepseek, {
    provider: "openrouter",
    model: "custom/deepseek",
    thinking: "high"
  });
  assert.deepEqual(aliases.sonnet, {
    provider: "openrouter",
    model: "~anthropic/claude-sonnet-latest",
    thinking: "high"
  });
  assert.equal(result.config.routes?.code, "sonnet");
  assert.equal(result.config.routes?.review, "deepseek");
  assert.equal(result.config.max_concurrency, 5);
});

test("routeProviderIssues reports route and default providers that are not authenticated", () => {
  const validated = validateConfig({
    defaults: {
      provider: "openrouter",
      model: null,
      thinking: null
    },
    aliases: {
      sonnet: {
        provider: "openrouter",
        model: "~anthropic/claude-sonnet-latest",
        thinking: "high"
      },
      gpt: {
        provider: "openai",
        model: "gpt-5.1",
        thinking: "medium"
      }
    },
    routes: {
      code: "sonnet",
      plan: "gpt",
      review: "openrouter/deepseek/deepseek-v4-pro"
    }
  });

  assert.equal(validated.ok, true);
  if (!validated.ok) {
    return;
  }

  assert.deepEqual(routeProviderIssues(validated.config, ["openai"]), [
    "defaults -> openrouter",
    "code -> openrouter",
    "review -> openrouter"
  ]);
});
