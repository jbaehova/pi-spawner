---
name: pi-spawner
description: Delegate host coding-agent subtasks to read-by-default Pi CLI model workers with optional direct-write permission, provider/model/thinking aliases, routes, parallel execution, write capture, and optional session continuity. Use when Codex, Claude Code, Cursor, Hermes, or another Agent Skills-compatible host should consult specialist models for writing, design critique, code review, planning, alternative patches, direct edits, or model comparison.
metadata:
  compatibility: Prefer the npm-installed pi-spawner CLI. Requires Node 20+, Python 3.10+, the pi CLI on PATH, and provider authentication for selected models. Designed for Agent Skills-compatible coding agents.
---

# Pi Spawner

Use this skill when the current host coding agent should keep top-level control while asking Pi CLI workers to produce specialist analysis, drafts, patch proposals, or explicitly requested direct edits with different models.

## Operating Model

- Treat the current host agent as the orchestrator and final authority.
- Treat Pi workers as subordinate subagents. Read tasks are advisory; write tasks may edit files directly, but the host agent reviews the captured filesystem changes.
- Prefer one-shot workers for isolated questions. Use a stable `session_id` only when the same worker needs continuity across related tasks.
- Run at most 3 read workers concurrently by default unless the user explicitly asks for a different limit. If any task uses `permission: "write"`, the wrapper runs all tasks sequentially so each worker's changes can be attributed.
- Treat `max_concurrency` in `~/.pi/pi-spawner/models.json` as the user's default read-worker limit. Top-level spec `max_concurrency` may override it for a single run.
- Keep Pi workers on `permission: "read"` by default with `read,grep,find,ls`. Use `permission: "write"` only when direct edits are intended; it enables `edit,write` but never `bash`.

## Preflight

If setup looks incomplete, ask the user to run:

```bash
pi-spawner doctor
```

The doctor command checks for the Pi CLI, Python 3.10+, provider credentials, model catalog access, and a valid Pi Spawner config. If it reports a failed step, do not try to work around that failure by silently switching providers or models.

## Model Selection

Prefer the user config created by the npm CLI at `~/.pi/pi-spawner/models.json`. Config precedence is:

```text
spec config_path > PI_SPAWNER_CONFIG > ~/.pi/pi-spawner/models.json > bundled models.json
```

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

Use the global CLI instead of hand-assembling multiple `pi` commands. It injects the configured `~/.pi/pi-spawner/models.json` path when the spec does not set `config_path`.

```bash
pi-spawner delegate --dry-run <<'JSON'
{
  "cwd": "/path/to/repo",
  "orchestrator_name": "Codex",
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
    },
    {
      "id": "edit",
      "route": "code",
      "permission": "write",
      "role": "implementation worker",
      "prompt": "Make the smallest direct edit needed for the failing test."
    }
  ]
}
JSON
```

Set `orchestrator_name` to the current host when useful, such as `Codex`, `Claude Code`, `Cursor`, or `Hermes Agent`. If omitted, the wrapper uses `the host coding agent`.

The wrapper returns normalized JSON with each worker's `summary`, model-output `diff`, `raw_output`, `errors`, `diagnostics`, resolved model fields, and `writes` capture for direct-write tasks.

## Task Spec

Provide a JSON object on stdin or with `--spec path.json`.

Top-level fields:

- `cwd`: Working directory for Pi. Defaults to the current directory.
- `config_path`: Optional path to a different `models.json`. If omitted, `pi-spawner delegate` uses `~/.pi/pi-spawner/models.json` when available.
- `orchestrator_name`: Optional host label used in Pi worker prompts. Defaults to `the host coding agent`.
- `alias`: Default alias for tasks that do not specify `alias` or `model`.
- `model`: Default model for tasks that do not specify `alias` or `model`.
- `provider`: Default provider when the selected alias/model does not include one.
- `thinking`: Run-level thinking override for tasks that do not set `thinking`.
- `permission`: Run-level permission, either `read` or `write`. Defaults to `read`.
- `default_route`: Default route when tasks do not specify `route`.
- `aliases`: Optional object that overrides or adds alias entries from `models.json`.
- `routes`: Optional object that overrides or adds route entries from `models.json`.
- `max_concurrency`: Per-run parallel read-worker limit. If omitted, the config-level `max_concurrency` is used. Any write-enabled task forces sequential execution.
- `timeout_seconds`: Per-worker timeout. Defaults to `600`.
- `session_dir`: Pi session directory for stateful workers. Defaults to `~/.pi/pi-spawner-workers`. When omitted, stateful tasks automatically use a non-empty legacy `~/.pi/codex-workers` directory for compatibility. Explicit `session_dir` always wins.
- `tasks`: Required list of worker tasks.

Each task supports:

- `id`: Stable result identifier.
- `role`: Short worker role, such as `frontend design critic`.
- `alias`: Alias from `models.json`, such as `kimi` or `deepseek`.
- `model`: Model alias, Pi model pattern, provider/model shorthand, or exact model ID.
- `route`: One of `design`, `writing`, `code`, `review`, `plan`.
- `provider`: Optional provider override for this task.
- `thinking`: One of `off`, `minimal`, `low`, `medium`, `high`, `xhigh`.
- `permission`: Optional task permission override, either `read` or `write`.
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
- If Pi fails because a provider is unavailable, auth is missing, or a model cannot run, return the failure JSON to the host agent and ask the user which configured alias, route, provider, or auth setup should be used instead.
- Use `--dry-run` before expensive or ambiguous delegations to inspect the resolved command without calling models.

## Output Handling

- Read `summary` first to decide whether the worker result is worth using.
- Apply `diff` only after the host agent reviews it against the actual files.
- For write tasks, inspect `writes.changed_files`, `writes.files`, and `writes.diff` to see what Pi actually changed. `diff` remains the model's textual output; `writes.diff` is the captured filesystem diff.
- Treat `writes.complete: false` or non-empty `writes.capture_errors` as a visibility failure that needs host review before trusting the worker's edits.
- If workers disagree, prefer grounded evidence from file references, tests, and concrete failure modes over model confidence.
- If a worker fails, use its `errors`, `diagnostics`, and `command` fields for diagnosis; do not assume other workers failed.

## Safety Defaults

- The wrapper defaults to read-only Pi tools: `read,grep,find,ls`.
- `permission: "write"` enables only `read,grep,find,ls,edit,write`, runs sequentially, and captures before/after filesystem changes under `cwd`.
- The wrapper uses `--no-session` unless `session_id` is present.
- The wrapper captures stdout/stderr and returns partial results when possible.
