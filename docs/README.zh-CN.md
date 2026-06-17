<h1 align="center">PI-SPAWNER</h1>

<p align="center">
  <strong>语言</strong><br>
  <a href="https://github.com/jbaehova/pi-spawner/blob/main/README.md">English</a> |
  <a href="https://github.com/jbaehova/pi-spawner/blob/main/docs/README.zh-CN.md"><strong>中文</strong></a> |
  <a href="https://github.com/jbaehova/pi-spawner/blob/main/docs/README.ko.md">한국어</a> |
  <a href="https://github.com/jbaehova/pi-spawner/blob/main/docs/README.es.md">Español</a> |
  <a href="https://github.com/jbaehova/pi-spawner/blob/main/docs/README.ja.md">日本語</a>
</p>

<p align="center">
  <strong>用于 Pi Agent 模型 worker 的 npm CLI 与 TUI 设置管理器</strong>
</p>

<p align="center">
  一次配置 alias、route、provider、model 和 thinking level，然后让 Codex、Claude Code、Cursor、Hermes Agent 等 host 调用同一个 Pi Spawner delegation CLI。
</p>

<p align="center">
  <img src="../assets/pi-spawner-banner.png" alt="Pi Spawner banner" width="70%">
</p>

## 功能

- 通过 npm 安装全局 `pi-spawner` CLI。
- 运行 `pi-spawner` 打开终端设置管理器。
- 使用 `pi-spawner doctor` 检查 Pi、Python、provider 和 model catalog。
- 用户设置保存在 `~/.pi/pi-spawner/models.json`。
- 管理 `kimi`、`deepseek`、`qwen`、`gemini` 等 alias。
- 将 `code`、`plan`、`writing`、`review`、`design` route 映射到 alias/model。
- 生成 Codex、Claude Code、Cursor 和 Hermes Agent adapter。
- Pi worker 默认只读；只有显式 write task 才能写入，并会捕获实际文件变更。

## 安装

要求：

- Node 20+
- Python 3.10+
- `PATH` 中可用的 Pi CLI
- delegation 前至少配置一个 Pi provider/API key

```bash
npm install -g pi-spawner
pi-spawner doctor
pi-spawner
```

如果 `doctor` 报告缺失步骤，请先完成对应的 Pi/Python/provider 设置。Pi Spawner 不会安装 Pi CLI，也不会管理 provider secret。

## 设置管理器

TUI 会先显示 doctor 页面，然后可管理：

- `Aliases`: provider/model/thinking 组合
- `Routes`: 任务类型到 alias/model 的映射
- `Runtime settings`: 默认并行 read-worker 限制
- `Model picker`: 基于已认证 provider 搜索 `pi --list-models`
- `Hosts`: Codex、Claude Code、Cursor、Hermes Agent adapter 生成指南

配置文件：

```text
~/.pi/pi-spawner/models.json
```

优先级：

```text
spec config_path > PI_SPAWNER_CONFIG > ~/.pi/pi-spawner/models.json > bundled defaults
```

## Host Adapter

```bash
pi-spawner hosts
```

生成的 adapter 位于 `~/.pi/pi-spawner/adapters`。不要把仓库本身作为 plugin 安装；先安装 npm package，再使用 `pi-spawner hosts` 生成的 adapter。

```bash
codex plugin add ~/.pi/pi-spawner/adapters/codex
claude --plugin-dir ~/.pi/pi-spawner/adapters/claude-code
ln -sfn ~/.pi/pi-spawner/adapters/cursor ~/.cursor/plugins/local/pi-spawner
hermes skills install ~/.pi/pi-spawner/adapters/hermes/skills/pi-spawner
```

## CLI 使用

```bash
pi-spawner delegate --dry-run <<'JSON'
{
  "cwd": "/path/to/repo",
  "orchestrator_name": "Codex",
  "tasks": [
    {
      "id": "review",
      "route": "review",
      "prompt": "Find regression risks in the recent diff."
    }
  ]
}
JSON
```

常用命令：

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

## 模型选择

```text
task alias/model > top-level alias/model > task route > default route > config defaults > Pi settings > Pi CLI defaults
```

Thinking 优先级：

```text
task thinking > top-level thinking > selected alias/model thinking > config defaults > Pi settings
```

只读 worker 会并行运行，最多为 `max_concurrency`，默认值为 `3`。如果包含 write task，则会顺序执行以便追踪文件变更。

## 开发

```bash
npm install
npm test
```

## 许可证

MIT。见 [LICENSE](../LICENSE)。
