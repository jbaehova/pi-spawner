import test from "node:test";
import assert from "node:assert/strict";
import { extractAuthProviderKeys, isAtLeastSupportedPython, parsePythonVersion } from "./doctor.js";

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

test("Python support starts at 3.9", () => {
  assert.deepEqual(parsePythonVersion("Python 3.9.6"), [3, 9, 6]);
  assert.equal(isAtLeastSupportedPython([3, 8, 18]), false);
  assert.equal(isAtLeastSupportedPython([3, 9, 0]), true);
  assert.equal(isAtLeastSupportedPython([3, 10, 0]), true);
});
