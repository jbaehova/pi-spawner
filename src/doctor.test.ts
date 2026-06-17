import test from "node:test";
import assert from "node:assert/strict";
import { extractAuthProviderKeys } from "./doctor.js";

test("extractAuthProviderKeys finds nested provider credentials without returning secret values", () => {
  const providers = extractAuthProviderKeys({
    providers: {
      openrouter: {
        apiKey: "sk-secret"
      },
      openai: {}
    },
    other: {
      anthropic: {
        token: "token"
      }
    }
  });

  assert.deepEqual(providers, ["anthropic", "openrouter"]);
});
