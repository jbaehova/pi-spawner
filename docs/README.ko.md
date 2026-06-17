<h1 align="center">PI-SPAWNER</h1>

<p align="center">
  <strong>언어</strong><br>
  <a href="https://github.com/jbaehova/pi-spawner/blob/main/README.md">English</a> |
  <a href="https://github.com/jbaehova/pi-spawner/blob/main/docs/README.zh-CN.md">中文</a> |
  <a href="https://github.com/jbaehova/pi-spawner/blob/main/docs/README.ko.md"><strong>한국어</strong></a> |
  <a href="https://github.com/jbaehova/pi-spawner/blob/main/docs/README.es.md">Español</a> |
  <a href="https://github.com/jbaehova/pi-spawner/blob/main/docs/README.ja.md">日本語</a>
</p>

<p align="center">
  <strong>Pi Agent 모델 워커를 위한 npm CLI 및 TUI 설정 관리자</strong>
</p>

<p align="center">
  alias, route, provider, model, thinking level을 한 번 설정하고 Codex, Claude Code, Cursor, Hermes Agent 같은 host에서 같은 Pi Spawner delegation CLI를 호출합니다.
</p>

<p align="center">
  <img src="../assets/pi-spawner-banner.png" alt="Pi Spawner banner" width="70%">
</p>

## 기능

- npm으로 전역 `pi-spawner` CLI를 설치합니다.
- `pi-spawner` 실행 시 터미널 설정 관리자를 엽니다.
- `pi-spawner doctor`로 Pi, Python, provider, model catalog 상태를 친절하게 진단합니다.
- 사용자 설정은 `~/.pi/pi-spawner/models.json`에 저장합니다.
- `sonnet`, `gpt`, `kimi`, `deepseek`, `qwen`, `gemini` 같은 alias를 관리합니다.
- `code`, `plan`, `writing`, `review`, `design` route를 alias/model에 매핑합니다.
- Codex, Claude Code, Cursor, Hermes Agent adapter를 생성합니다.
- Pi worker는 기본 read-only이며, write task는 명시적으로 요청해야 하고 변경사항을 캡처합니다.

## 설치

필수 조건:

- Node 20+
- Python 3.9+
- `PATH`에서 실행 가능한 Pi CLI
- delegation 전에 최소 하나의 Pi provider/API key 설정

```bash
npm install -g pi-spawner
pi-spawner doctor
pi-spawner
```

`doctor`가 누락된 단계를 보고하면 해당 Pi/Python/provider 설정을 먼저 완료한 뒤 다시 실행하세요. Pi Spawner는 Pi CLI나 provider secret을 대신 설치하지 않습니다.

## 설정 관리자

TUI는 단계형 setup wizard입니다. doctor 확인 뒤 모델 alias, route, read-worker 병렬 수, host 감지, 여러 host 선택, 설치 결과 확인까지 한 흐름으로 진행합니다. 화살표, Enter, Esc, Ctrl+C를 지원합니다.

- `Aliases`: provider/model/thinking 조합
- `Routes`: 작업 유형별 alias/model 매핑
- `Runtime settings`: 기본 병렬 read-worker 제한
- `Model picker`: 인증된 provider 기준의 전체 `pi --list-models` catalog 검색
- `Hosts`: 설치된 Codex, Claude Code, Cursor, Hermes Agent를 감지하고 선택한 host에 adapter 설치

설정 파일:

```text
~/.pi/pi-spawner/models.json
```

우선순위:

```text
spec config_path > PI_SPAWNER_CONFIG > ~/.pi/pi-spawner/models.json > bundled defaults
```

## Host Adapter

```bash
pi-spawner hosts
```

권장 경로는 `pi-spawner` setup wizard를 사용하는 것입니다. wizard가 설치된 host를 감지하고, 여러 host 선택 뒤 필요한 설치 작업을 실행합니다.

```bash
codex plugin add pi-spawner@personal
claude plugin marketplace add ~/.pi/pi-spawner/adapters/claude-marketplace --scope user
claude plugin install pi-spawner@pi-spawner --scope user
ln -sfn ~/.pi/pi-spawner/adapters/cursor ~/.cursor/plugins/local/pi-spawner
hermes skills install ~/.pi/pi-spawner/adapters/hermes/skills/pi-spawner
```

## CLI 사용

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

자주 쓰는 명령:

```bash
pi-spawner doctor --json
pi-spawner models openrouter
pi-spawner config path
pi-spawner config init --reset
pi-spawner config set max_concurrency 3
pi-spawner aliases list
pi-spawner aliases set sonnet --provider openrouter --model '~anthropic/claude-sonnet-latest' --thinking high
pi-spawner routes set review deepseek
```

## 모델 선택

```text
task alias/model > top-level alias/model > task route > default route > config defaults > Pi settings > Pi CLI defaults
```

Thinking 우선순위:

```text
task thinking > top-level thinking > selected alias/model thinking > config defaults > Pi settings
```

read-only worker는 `max_concurrency`까지 병렬 실행됩니다. 기본값은 `3`입니다. write task가 하나라도 포함되면 변경사항 추적을 위해 순차 실행됩니다.

## 개발

```bash
npm install
npm test
```

## 라이선스

MIT. [LICENSE](../LICENSE)를 참고하세요.
