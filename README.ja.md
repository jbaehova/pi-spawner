<h1 align="center">PI-SPAWNER</h1>

<p align="center">
  <strong>言語</strong><br>
  <a href="README.md">English</a> |
  <a href="README.zh-CN.md">中文</a> |
  <a href="README.ko.md">한국어</a> |
  <a href="README.es.md">Español</a> |
  <a href="README.ja.md"><strong>日本語</strong></a>
</p>

<p align="center">
  <strong>Pi Agent モデル worker のための npm CLI と TUI 設定マネージャー</strong>
</p>

<p align="center">
  alias、route、provider、model、thinking level を一度設定し、Codex、Claude Code、Cursor、Hermes Agent などの host から同じ Pi Spawner delegation CLI を呼び出します。
</p>

<p align="center">
  <img src="assets/pi-spawner-banner.png" alt="Pi Spawner banner" width="70%">
</p>

## 機能

- npm でグローバル `pi-spawner` CLI をインストールします。
- `pi-spawner` でターミナル設定マネージャーを開きます。
- `pi-spawner doctor` で Pi、Python、provider、model catalog を確認します。
- ユーザー設定は `~/.pi/pi-spawner/models.json` に保存されます。
- `kimi`、`deepseek`、`qwen`、`gemini` などの alias を管理します。
- `code`、`plan`、`writing`、`review`、`design` route を alias/model に割り当てます。
- Codex、Claude Code、Cursor、Hermes Agent adapter を生成します。
- Pi worker はデフォルトで read-only です。write task は明示的な指定が必要で、実際の変更内容を記録します。

## インストール

必要条件:

- Node 20+
- Python 3.10+
- `PATH` で利用できる Pi CLI
- delegation 前に少なくとも 1 つの Pi provider/API key を設定済みであること

```bash
npm install -g pi-spawner
pi-spawner doctor
pi-spawner
```

`doctor` が未完了の手順を表示した場合は、先に Pi/Python/provider の設定を完了してください。Pi Spawner は Pi CLI のインストールや provider secret の管理は行いません。

## 設定マネージャー

TUI は doctor 画面から始まり、次の項目を編集できます。

- `Aliases`: provider/model/thinking の組み合わせ
- `Routes`: タスク種別から alias/model への割り当て
- `Runtime settings`: read-worker のデフォルト並列数
- `Model picker`: 認証済み provider に基づく `pi --list-models` 検索
- `Hosts`: Codex、Claude Code、Cursor、Hermes Agent adapter の生成手順

設定ファイル:

```text
~/.pi/pi-spawner/models.json
```

優先順位:

```text
spec config_path > PI_SPAWNER_CONFIG > ~/.pi/pi-spawner/models.json > bundled defaults
```

## Host Adapter

```bash
pi-spawner hosts
```

生成された adapter は `~/.pi/pi-spawner/adapters` に保存されます。この repository 自体を plugin として直接インストールせず、npm package をインストールしてから `pi-spawner hosts` が生成した adapter を使ってください。

```bash
codex plugin add ~/.pi/pi-spawner/adapters/codex
claude --plugin-dir ~/.pi/pi-spawner/adapters/claude-code
ln -sfn ~/.pi/pi-spawner/adapters/cursor ~/.cursor/plugins/local/pi-spawner
hermes skills install ~/.pi/pi-spawner/adapters/hermes/skills/pi-spawner
```

## CLI 使用例

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

よく使うコマンド:

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

## モデル選択

```text
task alias/model > top-level alias/model > task route > default route > config defaults > Pi settings > Pi CLI defaults
```

Thinking の優先順位:

```text
task thinking > top-level thinking > selected alias/model thinking > config defaults > Pi settings
```

read-only worker は `max_concurrency` まで並列実行されます。デフォルトは `3` です。write task が含まれる場合、変更を正確に追跡するため順次実行されます。

## 開発

```bash
npm install
npm test
```

## ライセンス

MIT。詳細は [LICENSE](LICENSE) を参照してください。
