<h1 align="center">PI-SPAWNER</h1>

<p align="center">
  <strong>Plugin for delegating work to Pi Agent model workers</strong>
</p>

<p align="center">
  <em>The host agent stays in control. Pi workers read by default and can write only when explicitly allowed.</em>
</p>

<p align="center">
  <img alt="Python 3.10+" src="https://img.shields.io/badge/Python-3.10%2B-3776AB?style=flat-square&logo=python&logoColor=white">
  <img alt="Pi CLI" src="https://img.shields.io/badge/Pi-CLI-2563EB?style=flat-square">
  <img alt="Agent Skills" src="https://img.shields.io/badge/Agent-Skills-111827?style=flat-square">
  <img alt="License MIT" src="https://img.shields.io/badge/License-MIT-C5A800?style=flat-square">
</p>

<p align="center">
  <a href="#what-it-does">Features</a> &bull;
  <a href="#install">Install</a> &bull;
  <a href="#repository-layout">Layout</a> &bull;
  <a href="#model-selection">Model Selection</a> &bull;
  <a href="#cli-usage">CLI Usage</a>
</p>

> **Pi Spawner** lets Codex, Claude Code, Cursor, Hermes Agent, and other Agent Skills-compatible hosts delegate read-by-default subtasks to Pi CLI workers with per-task provider, model, thinking level, permission, aliases, and route-based defaults.

## What It Does

- Runs multiple Pi workers concurrently and returns normalized JSON
- Keeps Pi workers read-only by default with `read,grep,find,ls`
- Supports explicit direct-write tasks with `edit,write` and captured before/after filesystem changes
- Supports per-worker provider, model, thinking level, and session continuity
- Resolves simple model aliases such as `kimi`, `deepseek`, `qwen`, and `gemini`
- Falls back to route defaults for `design`, `writing`, `code`, `review`, and `plan`
- Avoids silent model fallback when a provider or model cannot run

## Install

Prereqs: Python 3.10+, an existing [Pi Coding Agent](https://pi.dev/) installation with `pi` on `PATH`, and provider authentication already configured for the models you will delegate to, such as Pi `/login`, `~/.pi/agent/auth.json`, or `OPENROUTER_API_KEY`.

Pi Spawner does not install Pi or set up provider credentials for you; it delegates to the Pi CLI that is already configured on the host.

Pi Spawner keeps the canonical skill/runtime at `skills/pi-spawner/`. Install it once per host.

### Codex

```bash
codex plugin marketplace add jbaehova/pi-spawner
codex plugin add pi-spawner@pi-spawner
```

Use: `Use $pi-spawner to ask Kimi and DeepSeek to review this diff.`

For local development, replace `jbaehova/pi-spawner` with `/absolute/path/to/pi-spawner`.

### Claude Code

```bash
claude --plugin-dir /absolute/path/to/pi-spawner
```

Use: `/pi-spawner:pi-spawner Ask Kimi and DeepSeek to review this diff.`

### Cursor

```bash
mkdir -p ~/.cursor/plugins/local
ln -s /absolute/path/to/pi-spawner ~/.cursor/plugins/local/pi-spawner
```

Reload Cursor, then use: `/pi-spawner Ask Kimi and DeepSeek to review this diff.`

### Hermes Agent

```bash
hermes skills install jbaehova/pi-spawner/skills/pi-spawner
```

Use: `/pi-spawner Ask Kimi and DeepSeek to review this diff.`

## Repository Layout

```text
.codex-plugin/plugin.json
.claude-plugin/plugin.json
.claude-plugin/marketplace.json
.cursor-plugin/plugin.json
skills.sh.json
assets/pi-spawner.svg
plugin -> .
skills/pi-spawner/SKILL.md
skills/pi-spawner/agents/openai.yaml
skills/pi-spawner/models.json
skills/pi-spawner/scripts/pi_delegate.py
```

`skills/pi-spawner/` is the canonical Agent Skill. The platform-specific manifest directories are thin wrappers around the same implementation.

`plugin` is a compatibility symlink to the repository root. It keeps the installable package at the root while giving marketplace entries a non-empty source path.

## Model Selection

Edit `skills/pi-spawner/models.json` to choose your own defaults.

Resolution order for each worker is:

```text
task alias/model > top-level alias/model > task route > default route > config defaults > Pi settings > Pi CLI defaults
```

Thinking is resolved separately:

```text
task thinking > top-level thinking > selected alias/model thinking > config defaults > Pi settings
```

The starter config defines these routes:

- `code`: `kimi`
- `plan`: `kimi`
- `writing`: `deepseek`
- `review`: `deepseek`
- `design`: `gemini`

Use explicit aliases when you want exact control:

```json
{
  "tasks": [
    {
      "id": "impl",
      "alias": "kimi",
      "route": "code",
      "prompt": "Review the auth refactor and propose a minimal patch."
    },
    {
      "id": "copy",
      "alias": "deepseek",
      "route": "writing",
      "prompt": "Rewrite the onboarding copy."
    }
  ]
}
```

If `alias` or `model` is present, it wins over `route`.

## CLI Usage

Dry-run a delegation before calling models:

```bash
python3 skills/pi-spawner/scripts/pi_delegate.py --dry-run <<'JSON'
{
  "cwd": "/path/to/repo",
  "orchestrator_name": "Claude Code",
  "tasks": [
    {
      "id": "design",
      "route": "design",
      "prompt": "Review the dashboard UI hierarchy and interaction polish."
    },
    {
      "id": "review",
      "alias": "deepseek",
      "thinking": "high",
      "prompt": "Find regression risks in the recent diff."
    },
    {
      "id": "edit",
      "route": "code",
      "permission": "write",
      "prompt": "Make the smallest direct edit needed for the failing test."
    }
  ]
}
JSON
```

Permissions have two tiers:

- `read` is the default and enables `read,grep,find,ls`.
- `write` enables `read,grep,find,ls,edit,write`, never `bash`. If any task uses `write`, all tasks run sequentially so Pi's direct edits can be attributed.

Run the same spec without `--dry-run` to execute the workers. The wrapper returns:

- `results[].summary`
- `results[].diff` for model-output diffs
- `results[].writes` for actual filesystem changes made by write tasks
- `results[].raw_output`
- `results[].errors`
- `results[].diagnostics`
- `results[].command`

For write tasks, `results[].writes` includes `changed_files`, per-file before/after SHA-256 hashes and sizes, `diff` for changed text files, `capture_errors`, and `complete`. Pi Spawner does not require a git repository for this capture; it snapshots regular files under `cwd` before and after each write task.

Stateful workers use `~/.pi/pi-spawner-workers` by default. When `session_id` is set and an existing legacy `~/.pi/codex-workers` directory contains sessions, Pi Spawner automatically uses that legacy directory for compatibility. An explicit `session_dir` always wins.

## Failure Behavior

Pi Spawner does not silently switch models. If a provider is not authenticated, a model is unavailable, or thinking is unsupported, the wrapper returns a structured failure so the host agent can ask which alias, route, provider, or auth setup to use next.

## License

MIT. See [LICENSE](LICENSE).
