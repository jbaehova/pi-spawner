<h1 align="center">Pi Spawner</h1>

<p align="center">
  <strong>Codex plugin for delegating work to Pi CLI model workers</strong>
</p>

<p align="center">
  <em>Codex stays in control. Pi workers provide second opinions.</em>
</p>

<p align="center">
  <img alt="Python 3.10+" src="https://img.shields.io/badge/Python-3.10%2B-3776AB?style=flat-square&logo=python&logoColor=white">
  <img alt="Pi CLI" src="https://img.shields.io/badge/Pi-CLI-2563EB?style=flat-square">
  <img alt="Codex Plugin" src="https://img.shields.io/badge/Codex-Plugin-111827?style=flat-square">
  <img alt="License MIT" src="https://img.shields.io/badge/License-MIT-C5A800?style=flat-square">
</p>

<p align="center">
  <a href="#what-it-does">Features</a> &bull;
  <a href="#install">Install</a> &bull;
  <a href="#model-selection">Model Selection</a> &bull;
  <a href="#cli-usage">CLI Usage</a> &bull;
  <a href="#license">License</a>
</p>

> **Pi Spawner** lets Codex delegate read-only subtasks to Pi CLI workers with per-task provider, model, thinking level, aliases, and route-based defaults.

## What It Does

- Runs multiple Pi workers concurrently and returns normalized JSON
- Keeps Pi workers read-only by default with `read,grep,find,ls`
- Supports per-worker provider, model, thinking level, and session continuity
- Resolves simple model aliases such as `kimi`, `deepseek`, `qwen`, and `gemini`
- Falls back to route defaults for `design`, `writing`, `code`, `review`, and `plan`
- Avoids silent model fallback when a provider or model cannot run

## Install

### Install As A Codex Plugin

Add this repository to Codex:

```bash
codex plugin marketplace add jbaehova/pi-spawner
```

Then install or enable **Pi Spawner** from Codex's Plugins UI.

For local development, add this checkout directly:

```bash
codex plugin marketplace add /absolute/path/to/pi-spawner
```

This repository is the installable Codex plugin package:

```text
.codex-plugin/plugin.json
plugin -> .
assets/pi-spawner.svg
skills/pi-spawner/SKILL.md
skills/pi-spawner/models.json
skills/pi-spawner/scripts/pi_delegate.py
```

`plugin` is a compatibility symlink to the repository root. It keeps the installable package at the root while giving Codex a non-empty marketplace source path.

## Requirements

- Python 3.10+
- `pi` CLI available on `PATH`
- Provider authentication configured for whichever provider aliases you use

Pi provider auth can come from Pi's own auth state or provider environment variables such as `OPENROUTER_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY`, `DEEPSEEK_API_KEY`, or `KIMI_API_KEY`.

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
    }
  ]
}
JSON
```

Run the same spec without `--dry-run` to execute the workers. The wrapper returns:

- `results[].summary`
- `results[].diff`
- `results[].raw_output`
- `results[].errors`
- `results[].diagnostics`
- `results[].command`

## Failure Behavior

Pi Spawner does not silently switch models. If a provider is not authenticated, a model is unavailable, or thinking is unsupported, the wrapper returns a structured failure so Codex can ask which alias, route, or provider to use next.

## License

MIT. See [LICENSE](LICENSE).
