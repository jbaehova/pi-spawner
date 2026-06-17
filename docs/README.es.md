<h1 align="center">PI-SPAWNER</h1>

<p align="center">
  <strong>Idioma</strong><br>
  <a href="https://github.com/jbaehova/pi-spawner/blob/main/README.md">English</a> |
  <a href="https://github.com/jbaehova/pi-spawner/blob/main/docs/README.zh-CN.md">中文</a> |
  <a href="https://github.com/jbaehova/pi-spawner/blob/main/docs/README.ko.md">한국어</a> |
  <a href="https://github.com/jbaehova/pi-spawner/blob/main/docs/README.es.md"><strong>Español</strong></a> |
  <a href="https://github.com/jbaehova/pi-spawner/blob/main/docs/README.ja.md">日本語</a>
</p>

<p align="center">
  <strong>CLI npm y gestor TUI para workers de modelos de Pi Agent</strong>
</p>

<p align="center">
  Configura aliases, routes, providers, models y thinking levels una vez, y deja que Codex, Claude Code, Cursor, Hermes Agent u otro host llamen al mismo CLI de delegación de Pi Spawner.
</p>

<p align="center">
  <img src="../assets/pi-spawner-banner.png" alt="Pi Spawner banner" width="70%">
</p>

## Qué Hace

- Instala un CLI global `pi-spawner` mediante npm.
- Abre un gestor de configuración en terminal con `pi-spawner`.
- Muestra una verificación amable con `pi-spawner doctor`.
- Guarda la configuración en `~/.pi/pi-spawner/models.json`.
- Gestiona aliases como `sonnet`, `gpt`, `kimi`, `deepseek`, `qwen` y `gemini`.
- Mapea routes como `code`, `plan`, `writing`, `review` y `design`.
- Genera adapters para Codex, Claude Code, Cursor y Hermes Agent.
- Mantiene los workers de Pi en modo solo lectura por defecto; las tareas con escritura deben pedirse explícitamente y sus cambios se capturan.

## Instalación

Requisitos:

- Node 20+
- Python 3.9+
- Pi CLI disponible en `PATH`
- Al menos un provider/API key configurado en Pi antes de delegar

```bash
npm install -g pi-spawner
pi-spawner doctor
pi-spawner
```

Si `doctor` muestra un paso pendiente, termina primero la configuración de Pi/Python/provider. Pi Spawner no instala Pi CLI ni administra secretos de providers.

## Gestor de Configuración

La TUI es un setup wizard por pasos. Recorre doctor, aliases de modelos, routes, concurrencia de read-workers,
detección de hosts, selección múltiple de hosts e instalación con resultados. Soporta flechas,
Enter, Esc y Ctrl+C.

- `Aliases`: combinaciones provider/model/thinking
- `Routes`: mapeos de tipo de tarea a alias/model
- `Runtime settings`: límite paralelo por defecto para read-workers
- `Model picker`: búsqueda del catalog completo de `pi --list-models` filtrada por providers autenticados
- `Hosts`: detección de Codex, Claude Code, Cursor y Hermes Agent instalados, con instalación de adapters para los hosts seleccionados

Archivo de configuración:

```text
~/.pi/pi-spawner/models.json
```

Precedencia:

```text
spec config_path > PI_SPAWNER_CONFIG > ~/.pi/pi-spawner/models.json > bundled defaults
```

## Host Adapters

```bash
pi-spawner hosts
```

La ruta recomendada es ejecutar `pi-spawner` y usar el setup wizard. Detecta hosts instalados, permite seleccionar varios y ejecuta los pasos de instalación necesarios.

```bash
codex plugin add pi-spawner@personal
claude plugin marketplace add ~/.pi/pi-spawner/adapters/claude-marketplace --scope user
claude plugin install pi-spawner@pi-spawner --scope user
ln -sfn ~/.pi/pi-spawner/adapters/cursor ~/.cursor/plugins/local/pi-spawner
hermes skills install ~/.pi/pi-spawner/adapters/hermes/skills/pi-spawner
```

## Uso del CLI

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

Comandos útiles:

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

## Selección de Modelo

```text
task alias/model > top-level alias/model > task route > default route > config defaults > Pi settings > Pi CLI defaults
```

Precedencia de thinking:

```text
task thinking > top-level thinking > selected alias/model thinking > config defaults > Pi settings
```

Los workers de solo lectura se ejecutan en paralelo hasta `max_concurrency`, con valor por defecto `3`. Si una ejecución contiene una tarea con escritura, todo se ejecuta de forma secuencial para poder atribuir los cambios.

## Desarrollo

```bash
npm install
npm test
```

## Licencia

MIT. Consulta [LICENSE](../LICENSE).
