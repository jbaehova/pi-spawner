<h1 align="center">PI-SPAWNER</h1>

<p align="center">
  <strong>Language</strong><br>
  <a href="https://github.com/jbaehova/pi-spawner/blob/main/README.md"><strong>English</strong></a> |
  <a href="https://github.com/jbaehova/pi-spawner/blob/main/docs/README.zh-CN.md">中文</a> |
  <a href="https://github.com/jbaehova/pi-spawner/blob/main/docs/README.ko.md">한국어</a> |
  <a href="https://github.com/jbaehova/pi-spawner/blob/main/docs/README.es.md">Español</a> |
  <a href="https://github.com/jbaehova/pi-spawner/blob/main/docs/README.ja.md">日本語</a>
</p>

<p align="center">
  <strong>NPM CLI and TUI settings manager for Pi Agent model workers</strong>
</p>

<p align="center">
  <em>Configure aliases, routes, providers, models, and thinking levels once, then let Codex, Claude Code, Cursor, Hermes Agent, or another Agent Skills host call the same Pi Spawner delegation CLI.</em>
</p>

<p align="center">
  <img alt="Node 20+" src="https://img.shields.io/badge/Node-20%2B-43853D?style=flat-square&logo=node.js&logoColor=white">
  <img alt="Python 3.10+" src="https://img.shields.io/badge/Python-3.10%2B-3776AB?style=flat-square&logo=python&logoColor=white">
  <img alt="Pi CLI" src="https://img.shields.io/badge/Pi-CLI-2563EB?style=flat-square">
  <img alt="License MIT" src="https://img.shields.io/badge/License-MIT-C5A800?style=flat-square">
</p>

<p align="center">
  <img src="assets/pi-spawner-banner.png" alt="Pi Spawner pixel art banner" width="70%">
</p>

## What It Does

- Installs a global `pi-spawner` CLI through npm.
- Opens a terminal settings manager with `pi-spawner`.
- Shows friendly preflight guidance with `pi-spawner doctor`.
- Stores user settings in `~/.pi/pi-spawner/models.json`.
- Manages aliases such as `kimi`, `deepseek`, `qwen`, and `gemini`.
- Maps task routes such as `code`, `plan`, `writing`, `review`, and `design`.
- Generates Codex, Claude Code, Cursor, and Hermes Agent adapters that call `pi-spawner delegate`.
- Keeps Pi workers read-only by default, with explicit write tasks captured for host review.

## Install

Prereqs:

- Node 20+
- Python 3.10+
- Pi CLI installed with `pi` on `PATH`
- At least one Pi provider/API key configured before delegation

Install the CLI:

```bash
npm install -g pi-spawner
```

Check setup:

```bash
pi-spawner doctor
```

Open the settings manager:

```bash
pi-spawner
```

If `doctor` reports a missing step, fix that Pi/Python/provider setup first and rerun it. Pi Spawner does not install Pi or manage provider secrets; it detects the Pi setup and gives concrete next steps.

## Settings Manager

The TUI starts with a doctor screen, then lets you inspect and edit:

- `Aliases`: provider/model/thinking triples
- `Routes`: task type to alias/model mappings
- `Runtime settings`: default parallel read-worker limit
- `Model picker`: searchable `pi --list-models` entries filtered to authenticated providers
- `Hosts`: generated adapter paths and install commands for Codex, Claude Code, Cursor, and Hermes Agent

Settings live at:

```text
~/.pi/pi-spawner/models.json
```

Config precedence is:

```text
spec config_path > PI_SPAWNER_CONFIG > ~/.pi/pi-spawner/models.json > bundled defaults
```

## Host Adapters

Generate adapters:

```bash
pi-spawner hosts
```

The generated adapters live under `~/.pi/pi-spawner/adapters`. They are intentionally thin: each host skill/plugin calls the global `pi-spawner delegate` command, so updating the npm package updates the runtime without rewriting host prompts.

Example generated guide:

```bash
codex plugin add ~/.pi/pi-spawner/adapters/codex
claude --plugin-dir ~/.pi/pi-spawner/adapters/claude-code
ln -sfn ~/.pi/pi-spawner/adapters/cursor ~/.cursor/plugins/local/pi-spawner
hermes skills install ~/.pi/pi-spawner/adapters/hermes/skills/pi-spawner
```

The repository itself is not the install target for host plugins. Install the npm package, then let `pi-spawner hosts` generate host-specific adapters that call the installed CLI.

## CLI Usage

Dry-run a delegation before calling models:

```bash
pi-spawner delegate --dry-run <<'JSON'
{
  "cwd": "/path/to/repo",
  "orchestrator_name": "Codex",
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

Run without `--dry-run` to execute workers.

Useful commands:

```bash
pi-spawner doctor --json
pi-spawner models openrouter
pi-spawner config path
pi-spawner config init --reset
pi-spawner config set max_concurrency 3
pi-spawner aliases list
pi-spawner aliases set kimi --provider openrouter --model moonshotai/kimi-k2.6 --thinking high
pi-spawner routes set review deepseek
```

## Model Selection

Resolution order for each worker is:

```text
task alias/model > top-level alias/model > task route > default route > config defaults > Pi settings > Pi CLI defaults
```

Thinking is resolved separately:

```text
task thinking > top-level thinking > selected alias/model thinking > config defaults > Pi settings
```

Read-only workers run concurrently up to `max_concurrency`, which defaults to `3`. Any run containing a write-enabled task still executes sequentially so direct file changes can be attributed.

Pi Spawner does not silently switch models. If a provider is not authenticated, a model is unavailable, or thinking is unsupported, the wrapper returns a structured failure so the host agent can ask which alias, route, provider, or auth setup should be used next.

## Repository Layout

```text
package.json
src/
dist/
skills/pi-spawner/SKILL.md
skills/pi-spawner/models.json
skills/pi-spawner/scripts/pi_delegate.py
assets/
docs/
```

`src/` is the npm CLI and TUI layer. `skills/pi-spawner/scripts/pi_delegate.py` remains the delegation engine for v1 compatibility.

## Development

```bash
npm install
npm test
```

Useful local checks:

```bash
node dist/cli.js doctor
node dist/cli.js delegate --dry-run < spec.json
python3 /Users/johnnybae/.codex/skills/.system/skill-creator/scripts/quick_validate.py skills/pi-spawner
```

## Publishing

The public npm package is unscoped:

```bash
npm publish --access public
```

The GitHub Packages variant must be scoped to the GitHub owner. The included GitHub Actions workflow publishes the same version as `@jbaehova/pi-spawner` by rewriting `package.json` only inside CI.

Before pushing a release tag, add an npm automation token as the repository secret `NPM_TOKEN`. GitHub Packages uses the workflow `GITHUB_TOKEN`.

```bash
node -p "require('./package.json').version"
npm test
npm pack --dry-run
git tag v0.3.0
git push origin HEAD --tags
```

## License

MIT. See [LICENSE](LICENSE).
