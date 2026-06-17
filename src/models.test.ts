import test from "node:test";
import assert from "node:assert/strict";
import { parseModelTable } from "./models.js";

test("parseModelTable parses pi fixed-width model output", () => {
  const rows = parseModelTable(`provider    model                                               context  max-out  thinking  images
openrouter  google/gemma-4-26b-a4b-it:free                    262.1K   32.8K    yes       yes
openrouter  qwen/qwen3-coder                                  1.0M     65.5K    no        no
`);

  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], {
    provider: "openrouter",
    model: "google/gemma-4-26b-a4b-it:free",
    context: "262.1K",
    maxOut: "32.8K",
    thinking: true,
    images: true
  });
  assert.equal(rows[1].thinking, false);
});
