---
name: pi-spawner
description: Delegate Codex subtasks to Pi CLI workers with per-worker provider, model, thinking level, aliases, route defaults, and optional session continuity. Use when Codex should consult other models through Pi for specialist writing, frontend/design critique, code review, alternative patches, model comparison, or parallel analysis while Codex remains the final editor.
---

# Pi Spawner

Use this skill when Codex should keep top-level control but ask Pi CLI workers to produce specialist analysis, drafts, or patch proposals with different models.

## Operating Model

- Treat Codex as the orchestrator and final authority.
- Treat Pi workers as advisory subagents. They may inspect files and return text or unified diffs, but Codex decides what to apply.
- Prefer one-shot workers for isolated questions. Use a stable `session_id` only when the same worker needs continuity across related tasks.
- Run at most 3 workers concurrently by default unless the user explicitly asks for a different limit.
- Keep Pi workers read-only by default with `read,grep,find,ls`. Do not give Pi `edit`, `write`, or `bash` unless the user explicitly overrides this skill's safety model.

## Model Selection

Use the bundled `models.json` first. Resolve it from this skill root, not from the user's current working directory.

Selection priority for each worker:

```text
task alias/model > top-level alias/model > task route > default route > config defaults > Pi settings > Pi CLI defaults
```

Thinking priority is separate:

```text
task thinking > top-level thinking > selected alias/model thinking > config defaults > Pi settings
```

Prefer explicit aliases when the user names a model family:

- `kimi` or `kimi-k2`: code, implementation, long-context reasoning
- `deepseek`: writing, review, alternative analysis
- `qwen`: code and structured technical analysis
- `gemini`: design critique, UI review, visual/product reasoning

Use these route names when the user names a task type but not a model:

- `design`: UI, UX, visual hierarchy, frontend polish, screenshots, layout critique
- `writing`: copy, docs, README, prose, translation, messaging
- `code`: implementation, debugging, refactor, tests, patch proposals
- `review`: code review, regression risk, PR review, security/quality findings
- `plan`: architecture, decomposition, tradeoffs, implementation planning

If no explicit alias/model and no clear route are present, use `default_route` from `models.json`, which starts as `code`.

## Quick Start

Use the bundled wrapper instead of hand-assembling multiple `pi` commands. From this skill directory:

```bash
python3 scripts/pi_delegate.py --dry-run <<'JSON'
{
  "cwd": "/path/to/repo",
  "max_concurrency": 3,
  "tasks": [
    {
      "id": "impl",
      "alias": "kimi",
      "role": "implementation reviewer",
      "prompt": "Review the auth refactor and propose a minimal patch if needed."
    },
    {
      "id": "copy",
      "route": "writing",
      "role": "writing specialist",
      "prompt": "Rewrite the empty-state copy in src/app/page.tsx."
    }
  ]
}
JSON
```

When running from another directory, use the absolute installed path to `scripts/pi_delegate.py`.

The wrapper returns normalized JSON with each worker's `summary`, `diff`, `raw_output`, `errors`, `diagnostics`, and resolved model fields.

## Task Spec

Provide a JSON object on stdin or with `--spec path.json`.

Top-level fields:

- `cwd`: Working directory for Pi. Default to the current directory.
- `config_path`: Optional path to a different `models.json`.
- `alias`: Default alias for tasks that do not specify `alias` or `model`.
- `model`: Default model for tasks that do not specify `alias` or `model`.
- `provider`: Default provider when the selected alias/model does not include one.
- `thinking`: Run-level thinking override for tasks that do not set `thinking`.
- `default_route`: Default route when tasks do not specify `route`.
- `aliases`: Optional object that overrides or adds alias entries from `models.json`.
- `routes`: Optional object that overrides or adds route entries from `models.json`.
- `max_concurrency`: Parallel worker limit. Default to `3`.
- `timeout_seconds`: Per-worker timeout. Default to `600`.
- `session_dir`: Pi session directory for stateful workers. Default to `~/.pi/codex-workers`.
- `tasks`: Required list of worker tasks.

Each task supports:

- `id`: Stable result identifier.
- `role`: Short worker role, such as `frontend design critic`.
- `alias`: Alias from `models.json`, such as `kimi` or `deepseek`.
- `model`: Model alias, Pi model pattern, provider/model shorthand, or exact model ID.
- `route`: One of `design`, `writing`, `code`, `review`, `plan`.
- `provider`: Optional provider override for this task.
- `thinking`: One of `off`, `minimal`, `low`, `medium`, `high`, `xhigh`.
- `prompt`: The actual worker assignment.
- `session_id`: Optional stable Pi session ID. Omit for one-shot calls.

## Provider And Model Rules

- Use `alias` for the normal path. Edit `models.json` when provider/model versions change.
- Use `model` for exact overrides. It may be an alias, a Pi model pattern, or a provider/model shorthand.
- If `model` contains `:high`, `:medium`, or another supported thinking suffix, the wrapper extracts it as a thinking default.
- If `model` starts with a known Pi provider prefix and no provider is already selected, the wrapper splits that prefix into `--provider`.
- If a selected alias includes `provider: openrouter`, OpenRouter model IDs such as `deepseek/deepseek-v3.2` stay intact.

## Failure Handling

- Do not silently switch to a different alias, route, provider, or model.
- If Pi fails because a provider is unavailable, auth is missing, or a model cannot run, return the failure JSON to Codex and ask the user which configured alias, route, or provider should be used instead.
- Use `--dry-run` before expensive or ambiguous delegations to inspect the resolved command without calling models.

## Output Handling

- Read `summary` first to decide whether the worker result is worth using.
- Apply `diff` only after Codex reviews it against the actual files.
- If workers disagree, prefer grounded evidence from file references, tests, and concrete failure modes over model confidence.
- If a worker fails, use its `errors`, `diagnostics`, and `command` fields for diagnosis; do not assume other workers failed.

## Safety Defaults

- The wrapper enforces read-only Pi tools: `read,grep,find,ls`.
- The wrapper uses `--no-session` unless `session_id` is present.
- The wrapper captures stdout/stderr and returns partial results when possible.
