#!/usr/bin/env python3
"""Run multiple Pi CLI worker tasks and normalize their outputs."""

from __future__ import annotations

import argparse
import asyncio
import difflib
import hashlib
import json
import os
import re
import shlex
import stat
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any


DEFAULT_MAX_CONCURRENCY = 3
DEFAULT_TIMEOUT_SECONDS = 600
READ_TOOLS = "read,grep,find,ls"
WRITE_TOOLS = "read,grep,find,ls,edit,write"
DEFAULT_ORCHESTRATOR_NAME = "the host coding agent"
DEFAULT_SESSION_DIR = "~/.pi/pi-spawner-workers"
LEGACY_SESSION_DIR = "~/.pi/codex-workers"
DEFAULT_PERMISSION = "read"
PERMISSION_LEVELS = {"read", "write"}
TEXT_DIFF_MAX_BYTES = 1_000_000
THINKING_LEVELS = {"off", "minimal", "low", "medium", "high", "xhigh"}
ROUTE_NAMES = {"design", "writing", "code", "review", "plan"}
KNOWN_PROVIDER_PREFIXES = {
    "anthropic",
    "azure",
    "cerebras",
    "cloudflare",
    "deepseek",
    "fireworks",
    "google",
    "groq",
    "kimi",
    "mistral",
    "moonshot",
    "nvidia",
    "openai",
    "openrouter",
    "together",
    "xai",
    "zai",
}
PROVIDER_AUTH_HINTS = {
    "anthropic": ["ANTHROPIC_API_KEY", "ANTHROPIC_OAUTH_TOKEN"],
    "azure": ["AZURE_OPENAI_API_KEY", "AZURE_OPENAI_BASE_URL"],
    "cerebras": ["CEREBRAS_API_KEY"],
    "cloudflare": ["CLOUDFLARE_API_KEY", "CLOUDFLARE_ACCOUNT_ID"],
    "deepseek": ["DEEPSEEK_API_KEY"],
    "fireworks": ["FIREWORKS_API_KEY"],
    "google": ["GEMINI_API_KEY"],
    "groq": ["GROQ_API_KEY"],
    "kimi": ["KIMI_API_KEY"],
    "mistral": ["MISTRAL_API_KEY"],
    "moonshot": ["MOONSHOT_API_KEY"],
    "nvidia": ["NVIDIA_API_KEY"],
    "openai": ["OPENAI_API_KEY"],
    "openrouter": ["OPENROUTER_API_KEY"],
    "together": ["TOGETHER_API_KEY"],
    "xai": ["XAI_API_KEY"],
    "zai": ["ZAI_API_KEY"],
}
BUILTIN_CONFIG = {
    "default_route": "code",
    "max_concurrency": DEFAULT_MAX_CONCURRENCY,
    "defaults": {"provider": None, "model": None, "thinking": None},
    "aliases": {
        "sonnet": {
            "provider": "openrouter",
            "model": "~anthropic/claude-sonnet-latest",
            "thinking": "high",
        },
        "opus": {
            "provider": "openrouter",
            "model": "~anthropic/claude-opus-latest",
            "thinking": "high",
        },
        "gpt": {
            "provider": "openrouter",
            "model": "~openai/gpt-latest",
            "thinking": "high",
        },
        "kimi": {
            "provider": "openrouter",
            "model": "~moonshotai/kimi-latest",
            "thinking": "high",
        },
        "kimi-code": {
            "provider": "openrouter",
            "model": "moonshotai/kimi-k2.7-code",
            "thinking": "high",
        },
        "deepseek": {
            "provider": "openrouter",
            "model": "deepseek/deepseek-v4-pro",
            "thinking": "high",
        },
        "qwen": {
            "provider": "openrouter",
            "model": "qwen/qwen3.7-plus",
            "thinking": "high",
        },
        "gemini": {
            "provider": "openrouter",
            "model": "~google/gemini-pro-latest",
            "thinking": "high",
        },
    },
    "routes": {
        "code": "sonnet",
        "plan": "gpt",
        "writing": "deepseek",
        "review": "deepseek",
        "design": "gemini",
    },
}


class SpecError(ValueError):
    """Raised when the input task spec is invalid."""


@dataclass(frozen=True)
class ModelChoice:
    provider: str | None
    model: str | None
    thinking: str | None
    alias: str | None
    route: str | None
    source: str


@dataclass(frozen=True)
class WorkerTask:
    task_id: str
    role: str
    route: str | None
    alias: str | None
    provider: str | None
    model: str | None
    thinking: str | None
    prompt: str
    cwd: Path
    session_id: str | None
    session_dir: Path
    timeout_seconds: int
    model_source: str
    orchestrator_name: str
    permission: str
    tools: str


@dataclass(frozen=True)
class FileState:
    size: int
    sha256: str
    text: str | None
    diff_omitted: str | None


@dataclass(frozen=True)
class WorkspaceSnapshot:
    files: dict[str, FileState]
    errors: list[dict[str, str]]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Delegate tasks to Pi CLI workers and return normalized JSON."
    )
    parser.add_argument("--spec", help="Read task spec JSON from this file instead of stdin.")
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print planned Pi commands without executing them.",
    )
    return parser.parse_args()


def skill_root() -> Path:
    return Path(__file__).resolve().parents[1]


def default_config_path() -> Path:
    return skill_root() / "models.json"


def user_config_path() -> Path:
    env_config = os.environ.get("PI_SPAWNER_CONFIG")
    if env_config:
        return Path(env_config).expanduser()
    return Path("~/.pi/pi-spawner/models.json").expanduser()


def discover_config_path() -> tuple[Path, bool]:
    env_config = os.environ.get("PI_SPAWNER_CONFIG")
    if env_config:
        return Path(env_config).expanduser(), True

    user_path = user_config_path()
    if user_path.exists():
        return user_path, False

    return default_config_path(), False


def load_spec(path: str | None) -> dict[str, Any]:
    try:
        if path:
            return json.loads(Path(path).expanduser().read_text(encoding="utf-8"))
        stdin_data = sys.stdin.read()
        if not stdin_data.strip():
            raise SpecError("No JSON spec provided on stdin.")
        return json.loads(stdin_data)
    except json.JSONDecodeError as exc:
        raise SpecError(f"Invalid JSON spec: {exc}") from exc
    except OSError as exc:
        raise SpecError(f"Could not read spec: {exc}") from exc


def read_json_file(path: Path, *, required: bool = False) -> dict[str, Any]:
    try:
        return json.loads(path.expanduser().read_text(encoding="utf-8"))
    except FileNotFoundError:
        if required:
            raise SpecError(f"Config file not found: {path}") from None
        return {}
    except json.JSONDecodeError as exc:
        raise SpecError(f"Invalid JSON in {path}: {exc}") from exc
    except OSError as exc:
        raise SpecError(f"Could not read {path}: {exc}") from exc


def as_int(value: Any, *, default: int, name: str, minimum: int = 1) -> int:
    if value is None:
        return default
    try:
        parsed = int(value)
    except (TypeError, ValueError) as exc:
        raise SpecError(f"{name} must be an integer.") from exc
    if parsed < minimum:
        raise SpecError(f"{name} must be >= {minimum}.")
    return parsed


def optional_str(value: Any, *, name: str) -> str | None:
    if value is None:
        return None
    if not isinstance(value, str):
        raise SpecError(f"{name} must be a string when provided.")
    value = value.strip()
    return value or None


def validate_thinking(value: Any, *, name: str = "thinking") -> str | None:
    thinking = optional_str(value, name=name)
    if thinking is None:
        return None
    if thinking not in THINKING_LEVELS:
        raise SpecError(
            f"{name} must be one of {', '.join(sorted(THINKING_LEVELS))}; got {thinking!r}."
        )
    return thinking


def validate_permission(value: Any, *, name: str = "permission") -> str | None:
    permission = optional_str(value, name=name)
    if permission is None:
        return None
    if permission not in PERMISSION_LEVELS:
        raise SpecError(
            f"{name} must be one of {', '.join(sorted(PERMISSION_LEVELS))}; got {permission!r}."
        )
    return permission


def tools_for_permission(permission: str) -> str:
    if permission == "write":
        return WRITE_TOOLS
    return READ_TOOLS


def merge_config(file_config: dict[str, Any], spec: dict[str, Any]) -> dict[str, Any]:
    config = json.loads(json.dumps(BUILTIN_CONFIG))
    for source in (file_config, spec):
        if not isinstance(source, dict):
            continue
        if "default_route" in source:
            config["default_route"] = source["default_route"]
        if "max_concurrency" in source:
            config["max_concurrency"] = source["max_concurrency"]
        if "defaults" in source:
            if not isinstance(source["defaults"], dict):
                raise SpecError("defaults must be an object when provided.")
            config.setdefault("defaults", {}).update(source["defaults"])
        for key in ("provider", "model", "thinking"):
            if key in source:
                config.setdefault("defaults", {})[key] = source[key]
        if "aliases" in source:
            if not isinstance(source["aliases"], dict):
                raise SpecError("aliases must be an object when provided.")
            config.setdefault("aliases", {}).update(source["aliases"])
        if "routes" in source:
            if not isinstance(source["routes"], dict):
                raise SpecError("routes must be an object when provided.")
            config.setdefault("routes", {}).update(source["routes"])
    return config


def load_model_config(spec: dict[str, Any]) -> dict[str, Any]:
    config_path = optional_str(spec.get("config_path"), name="config_path")
    if config_path:
        file_config = read_json_file(Path(config_path).expanduser(), required=True)
    else:
        discovered_path, required = discover_config_path()
        file_config = read_json_file(discovered_path, required=required)
    return merge_config(file_config, spec)


def load_pi_settings() -> dict[str, Any]:
    agent_dir = Path(os.environ.get("PI_CODING_AGENT_DIR") or "~/.pi/agent").expanduser()
    settings = read_json_file(agent_dir / "settings.json")
    return {
        "provider": settings.get("defaultProvider"),
        "model": settings.get("defaultModel"),
        "thinking": settings.get("defaultThinkingLevel"),
    }


def has_directory_entries(path: Path) -> bool:
    try:
        next(path.iterdir())
    except (FileNotFoundError, NotADirectoryError, StopIteration, OSError):
        return False
    return True


def resolve_session_dir(configured_session_dir: str | None, session_id: str | None) -> Path:
    if configured_session_dir:
        return Path(configured_session_dir).expanduser().resolve()

    legacy_dir = Path(LEGACY_SESSION_DIR).expanduser().resolve()
    if session_id and has_directory_entries(legacy_dir):
        return legacy_dir

    return Path(DEFAULT_SESSION_DIR).expanduser().resolve()


def split_model_token(model: str, provider_hint: str | None) -> tuple[str | None, str, str | None]:
    resolved = model.strip()
    thinking: str | None = None
    if ":" in resolved:
        possible_model, possible_thinking = resolved.rsplit(":", 1)
        if possible_thinking in THINKING_LEVELS:
            resolved = possible_model
            thinking = possible_thinking

    provider = provider_hint
    if provider is None and "/" in resolved:
        prefix, remainder = resolved.split("/", 1)
        if prefix in KNOWN_PROVIDER_PREFIXES and remainder:
            provider = prefix
            resolved = remainder

    return provider, resolved, thinking


def normalize_choice(
    value: Any,
    *,
    aliases: dict[str, Any],
    default_provider: str | None,
    source: str,
    route: str | None = None,
    seen_aliases: set[str] | None = None,
) -> ModelChoice:
    seen_aliases = seen_aliases or set()

    if isinstance(value, str):
        token = value.strip()
        if not token:
            raise SpecError(f"{source} must not be empty.")
        if token in aliases:
            if token in seen_aliases:
                raise SpecError(f"Alias cycle detected: {' -> '.join(sorted(seen_aliases | {token}))}")
            choice = normalize_choice(
                aliases[token],
                aliases=aliases,
                default_provider=default_provider,
                source=f"alias:{token}",
                route=route,
                seen_aliases=seen_aliases | {token},
            )
            return ModelChoice(
                provider=choice.provider,
                model=choice.model,
                thinking=choice.thinking,
                alias=token,
                route=route,
                source=choice.source,
            )
        provider, model, thinking = split_model_token(token, default_provider)
        return ModelChoice(provider, model, thinking, None, route, source)

    if not isinstance(value, dict):
        raise SpecError(f"{source} must be a string or object.")

    alias = optional_str(value.get("alias"), name=f"{source}.alias")
    if alias:
        if alias not in aliases:
            raise SpecError(
                f"Unknown alias {alias!r}. Available aliases: {', '.join(sorted(aliases))}."
            )
        return normalize_choice(
            alias,
            aliases=aliases,
            default_provider=default_provider,
            source=source,
            route=route,
            seen_aliases=seen_aliases,
        )

    provider_hint = optional_str(value.get("provider"), name=f"{source}.provider") or default_provider
    model = optional_str(value.get("model"), name=f"{source}.model")
    thinking = validate_thinking(value.get("thinking"), name=f"{source}.thinking")
    if model is None:
        raise SpecError(f"{source}.model is required when no alias is provided.")

    provider, resolved_model, thinking_from_model = split_model_token(model, provider_hint)
    return ModelChoice(provider, resolved_model, thinking or thinking_from_model, None, route, source)


def resolve_task_choice(
    raw_task: dict[str, Any],
    spec: dict[str, Any],
    config: dict[str, Any],
    pi_settings: dict[str, Any],
    task_id: str,
) -> ModelChoice:
    aliases = config.get("aliases") or {}
    routes = config.get("routes") or {}
    defaults = config.get("defaults") or {}
    if not isinstance(aliases, dict):
        raise SpecError("aliases must be an object.")
    if not isinstance(routes, dict):
        raise SpecError("routes must be an object.")
    if not isinstance(defaults, dict):
        raise SpecError("defaults must be an object.")

    task_provider = optional_str(raw_task.get("provider"), name=f"task {task_id} provider")
    task_thinking = validate_thinking(raw_task.get("thinking"), name=f"task {task_id} thinking")
    spec_thinking = validate_thinking(spec.get("thinking"), name="thinking")
    explicit_default_provider = task_provider or optional_str(
        defaults.get("provider"), name="defaults.provider"
    )

    task_alias = optional_str(raw_task.get("alias"), name=f"task {task_id} alias")
    spec_alias = optional_str(spec.get("alias"), name="alias")
    task_model = raw_task.get("model")
    spec_model = spec.get("model")

    if task_alias:
        explicit_value: Any = {"alias": task_alias}
    elif task_model is not None:
        explicit_value = task_model
    elif spec_alias:
        explicit_value = {"alias": spec_alias}
    elif spec_model is not None:
        explicit_value = spec_model
    else:
        explicit_value = None

    if explicit_value is not None:
        choice = normalize_choice(
            explicit_value,
            aliases=aliases,
            default_provider=explicit_default_provider,
            source=f"task:{task_id}",
        )
    else:
        route = (
            optional_str(raw_task.get("route"), name=f"task {task_id} route")
            or optional_str(config.get("default_route"), name="default_route")
        )
        if route and route not in routes:
            raise SpecError(
                f"Unknown route {route!r}. Available routes: {', '.join(sorted(routes))}."
            )
        if route:
            choice = normalize_choice(
                routes[route],
                aliases=aliases,
                default_provider=explicit_default_provider,
                source=f"route:{route}",
                route=route,
            )
        else:
            choice = ModelChoice(None, None, None, None, None, "pi-defaults")

    provider = task_provider or choice.provider
    model = choice.model
    thinking = task_thinking or spec_thinking or choice.thinking

    if model is None:
        model_from_defaults = optional_str(defaults.get("model"), name="defaults.model")
        if model_from_defaults:
            provider, model, thinking_from_model = split_model_token(model_from_defaults, provider)
            thinking = thinking or thinking_from_model
        else:
            pi_model = optional_str(pi_settings.get("model"), name="Pi defaultModel")
            if pi_model:
                provider, model, thinking_from_model = split_model_token(pi_model, provider)
                thinking = thinking or thinking_from_model

    thinking = (
        thinking
        or validate_thinking(defaults.get("thinking"), name="defaults.thinking")
        or validate_thinking(pi_settings.get("thinking"), name="Pi defaultThinkingLevel")
    )

    if provider is None:
        provider = optional_str(defaults.get("provider"), name="defaults.provider") or optional_str(
            pi_settings.get("provider"), name="Pi defaultProvider"
        )

    return ModelChoice(
        provider=provider,
        model=model,
        thinking=thinking,
        alias=choice.alias,
        route=choice.route,
        source=choice.source,
    )


def build_tasks(spec: dict[str, Any]) -> tuple[list[WorkerTask], int]:
    if not isinstance(spec, dict):
        raise SpecError("Top-level spec must be a JSON object.")

    raw_tasks = spec.get("tasks")
    if not isinstance(raw_tasks, list) or not raw_tasks:
        raise SpecError("Spec must include a non-empty tasks list.")

    cwd = Path(spec.get("cwd") or os.getcwd()).expanduser().resolve()
    if not cwd.exists() or not cwd.is_dir():
        raise SpecError(f"cwd must be an existing directory: {cwd}")

    config = load_model_config(spec)
    pi_settings = load_pi_settings()

    max_concurrency = as_int(
        config.get("max_concurrency"),
        default=DEFAULT_MAX_CONCURRENCY,
        name="max_concurrency",
    )
    timeout_seconds = as_int(
        spec.get("timeout_seconds"),
        default=DEFAULT_TIMEOUT_SECONDS,
        name="timeout_seconds",
    )
    configured_session_dir = optional_str(spec.get("session_dir"), name="session_dir")
    orchestrator_name = optional_str(
        spec.get("orchestrator_name"), name="orchestrator_name"
    ) or DEFAULT_ORCHESTRATOR_NAME
    spec_permission = (
        validate_permission(spec.get("permission"), name="permission") or DEFAULT_PERMISSION
    )

    tasks: list[WorkerTask] = []
    seen_ids: set[str] = set()
    for index, raw_task in enumerate(raw_tasks, start=1):
        if not isinstance(raw_task, dict):
            raise SpecError(f"Task #{index} must be an object.")
        task_id = str(raw_task.get("id") or f"task-{index}")
        if task_id in seen_ids:
            raise SpecError(f"Duplicate task id: {task_id}")
        seen_ids.add(task_id)

        prompt = raw_task.get("prompt")
        if not isinstance(prompt, str) or not prompt.strip():
            raise SpecError(f"Task {task_id} must include a non-empty prompt.")

        choice = resolve_task_choice(raw_task, spec, config, pi_settings, task_id)
        session_id = raw_task.get("session_id")
        if session_id is not None:
            session_id = str(session_id).strip()
            if not session_id:
                session_id = None
        session_dir = resolve_session_dir(configured_session_dir, session_id)
        permission = (
            validate_permission(raw_task.get("permission"), name=f"task {task_id} permission")
            or spec_permission
        )

        role = str(raw_task.get("role") or "specialist worker")
        tasks.append(
            WorkerTask(
                task_id=task_id,
                role=role,
                route=choice.route,
                alias=choice.alias,
                provider=choice.provider,
                model=choice.model,
                thinking=choice.thinking,
                prompt=prompt.strip(),
                cwd=cwd,
                session_id=session_id,
                session_dir=session_dir,
                timeout_seconds=as_int(
                    raw_task.get("timeout_seconds"),
                    default=timeout_seconds,
                    name=f"task {task_id} timeout_seconds",
                ),
                model_source=choice.source,
                orchestrator_name=orchestrator_name,
                permission=permission,
                tools=tools_for_permission(permission),
            )
        )

    return tasks, max_concurrency


def worker_prompt(task: WorkerTask) -> str:
    if task.permission == "write":
        rules = """- You may modify files directly with the available edit/write tools.
- Keep changes tightly scoped to the assignment and the current working directory.
- Do not attempt to run shell commands; bash is not available in this permission tier.
- Summarize the files you changed and why.
- Codex will collect the actual filesystem changes after you finish."""
    else:
        rules = """- Inspect files as needed, but do not modify files.
- Return recommendations, analysis, drafts, or a unified diff only.
- If proposing code changes, include a single fenced ```diff block."""

    return f"""You are a Pi worker subordinate to {task.orchestrator_name}.

Role: {task.role}
Permission: {task.permission}

Rules:
{rules}
- Ground claims in concrete file paths, symbols, commands, or observed behavior.
- Keep the response concise and useful for {task.orchestrator_name} to review.

Assignment:
{task.prompt}
"""


def command_for(task: WorkerTask) -> list[str]:
    command = ["pi", "-p", "--mode", "json", "--tools", task.tools]
    if task.provider:
        command.extend(["--provider", task.provider])
    if task.model:
        command.extend(["--model", task.model])
    if task.thinking:
        command.extend(["--thinking", task.thinking])
    if task.session_id:
        command.extend(["--session-dir", str(task.session_dir), "--session-id", task.session_id])
    else:
        command.append("--no-session")
    command.append(worker_prompt(task))
    return command


def collect_strings(value: Any, strings: list[str]) -> None:
    if isinstance(value, str):
        if value.strip():
            strings.append(value)
        return
    if isinstance(value, list):
        for item in value:
            collect_strings(item, strings)
        return
    if isinstance(value, dict):
        for key in ("text", "content", "message", "delta", "output", "result"):
            if key in value:
                collect_strings(value[key], strings)


def extract_text(stdout: str) -> str:
    lines = [line for line in stdout.splitlines() if line.strip()]
    strings: list[str] = []
    parsed_any = False
    for line in lines:
        try:
            value = json.loads(line)
        except json.JSONDecodeError:
            continue
        parsed_any = True
        collect_strings(value, strings)

    if strings:
        deduped: list[str] = []
        for item in strings:
            if not deduped or deduped[-1] != item:
                deduped.append(item)
        return "\n".join(deduped).strip()

    if parsed_any:
        return stdout.strip()

    try:
        value = json.loads(stdout)
    except json.JSONDecodeError:
        return stdout.strip()
    strings = []
    collect_strings(value, strings)
    return "\n".join(strings).strip() or stdout.strip()


def extract_diff(text: str) -> str:
    fenced = re.search(r"```(?:diff|patch)\s*\n(.*?)```", text, re.DOTALL | re.IGNORECASE)
    if fenced:
        return fenced.group(1).strip()

    lines = text.splitlines()
    for index, line in enumerate(lines):
        if line.startswith("diff --git ") or line.startswith("--- "):
            return "\n".join(lines[index:]).strip()
    return ""


def summarize(text: str, diff: str) -> str:
    without_diff = text.replace(diff, "") if diff else text
    for line in without_diff.splitlines():
        stripped = line.strip(" #`")
        if stripped:
            return stripped[:500]
    return ""


def relative_path(path: Path, root: Path) -> str:
    try:
        return path.relative_to(root).as_posix()
    except ValueError:
        return str(path)


def state_for_bytes(data: bytes) -> FileState:
    diff_omitted: str | None = None
    text: str | None = None
    if len(data) > TEXT_DIFF_MAX_BYTES:
        diff_omitted = "too_large"
    elif b"\0" in data:
        diff_omitted = "binary"
    else:
        try:
            text = data.decode("utf-8")
        except UnicodeDecodeError:
            diff_omitted = "non_utf8"

    return FileState(
        size=len(data),
        sha256=hashlib.sha256(data).hexdigest(),
        text=text,
        diff_omitted=diff_omitted,
    )


def capture_workspace(root: Path) -> WorkspaceSnapshot:
    files: dict[str, FileState] = {}
    errors: list[dict[str, str]] = []

    def on_walk_error(exc: OSError) -> None:
        filename = exc.filename or str(root)
        errors.append({"path": relative_path(Path(filename), root), "error": str(exc)})

    for dirpath, dirnames, filenames in os.walk(root, topdown=True, onerror=on_walk_error):
        dirnames.sort()
        filenames.sort()
        for filename in filenames:
            path = Path(dirpath) / filename
            rel_path = relative_path(path, root)
            try:
                file_stat = path.lstat()
                if not stat.S_ISREG(file_stat.st_mode):
                    continue
                files[rel_path] = state_for_bytes(path.read_bytes())
            except OSError as exc:
                errors.append({"path": rel_path, "error": str(exc)})

    return WorkspaceSnapshot(files=files, errors=errors)


def diff_for_file(path: str, before: FileState | None, after: FileState | None) -> str:
    if before and before.text is None:
        return ""
    if after and after.text is None:
        return ""

    before_lines = before.text.splitlines(keepends=True) if before else []
    after_lines = after.text.splitlines(keepends=True) if after else []
    fromfile = f"a/{path}" if before else "/dev/null"
    tofile = f"b/{path}" if after else "/dev/null"
    return "".join(
        difflib.unified_diff(
            before_lines,
            after_lines,
            fromfile=fromfile,
            tofile=tofile,
        )
    )


def write_entry(
    change_type: str, before: FileState | None, after: FileState | None
) -> dict[str, Any]:
    diff_omitted = None
    if before and before.diff_omitted:
        diff_omitted = before.diff_omitted
    if after and after.diff_omitted:
        diff_omitted = after.diff_omitted

    return {
        "change": change_type,
        "size_before": before.size if before else None,
        "size_after": after.size if after else None,
        "sha256_before": before.sha256 if before else None,
        "sha256_after": after.sha256 if after else None,
        "text_diff": bool(
            (before is None or before.text is not None)
            and (after is None or after.text is not None)
        ),
        "diff_omitted": diff_omitted,
    }


def compare_workspaces(before: WorkspaceSnapshot, after: WorkspaceSnapshot) -> dict[str, Any]:
    changed_files: list[str] = []
    files: dict[str, dict[str, Any]] = {}
    diff_parts: list[str] = []

    for path in sorted(set(before.files) | set(after.files)):
        before_state = before.files.get(path)
        after_state = after.files.get(path)
        if before_state and after_state and before_state.sha256 == after_state.sha256:
            continue

        if before_state is None:
            change_type = "added"
        elif after_state is None:
            change_type = "deleted"
        else:
            change_type = "modified"

        changed_files.append(path)
        files[path] = write_entry(change_type, before_state, after_state)
        text_diff = diff_for_file(path, before_state, after_state)
        if text_diff:
            diff_parts.append(text_diff)

    capture_errors = before.errors + after.errors
    return {
        "changed_files": changed_files,
        "files": files,
        "diff": "\n".join(part.rstrip("\n") for part in diff_parts),
        "capture_errors": capture_errors,
        "complete": not capture_errors,
    }


def empty_write_capture(errors: list[dict[str, str]]) -> dict[str, Any]:
    return {
        "changed_files": [],
        "files": {},
        "diff": "",
        "capture_errors": errors,
        "complete": not errors,
    }


def diagnostics_for(task: WorkerTask, exit_code: int | None, stderr: str) -> dict[str, Any]:
    diagnostics: dict[str, Any] = {
        "model_source": task.model_source,
        "auth_env_vars": PROVIDER_AUTH_HINTS.get(task.provider or "", []),
    }
    lower_stderr = stderr.lower()
    if exit_code not in (0, None):
        diagnostics["failure_policy"] = "no_auto_fallback"
        diagnostics["ask_user_for"] = "alias, route, provider, model, or provider authentication"
    if any(word in lower_stderr for word in ("api key", "auth", "unauthorized", "forbidden", "login")):
        diagnostics["possible_auth_failure"] = True
    if "model" in lower_stderr and any(word in lower_stderr for word in ("not found", "unknown", "unsupported")):
        diagnostics["possible_model_failure"] = True
    return diagnostics


async def run_task(task: WorkerTask, semaphore: asyncio.Semaphore) -> dict[str, Any]:
    command = command_for(task)
    before_snapshot: WorkspaceSnapshot | None = None
    if task.permission == "write":
        before_snapshot = capture_workspace(task.cwd)
        if before_snapshot.errors:
            return result_for(
                task,
                command,
                125,
                "",
                "Could not capture pre-write workspace snapshot.",
                writes=empty_write_capture(before_snapshot.errors),
            )

    async with semaphore:
        try:
            proc = await asyncio.create_subprocess_exec(
                *command,
                cwd=str(task.cwd),
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            stdout_bytes, stderr_bytes = await asyncio.wait_for(
                proc.communicate(), timeout=task.timeout_seconds
            )
            exit_code = proc.returncode
        except asyncio.TimeoutError:
            try:
                proc.kill()
            except ProcessLookupError:
                pass
            try:
                await proc.wait()
            except ProcessLookupError:
                pass
            writes = (
                compare_workspaces(before_snapshot, capture_workspace(task.cwd))
                if before_snapshot is not None
                else None
            )
            return result_for(
                task,
                command,
                124,
                "",
                f"Timed out after {task.timeout_seconds}s",
                writes=writes,
            )
        except FileNotFoundError:
            writes = (
                compare_workspaces(before_snapshot, capture_workspace(task.cwd))
                if before_snapshot is not None
                else None
            )
            return result_for(
                task,
                command,
                127,
                "",
                "pi executable not found on PATH",
                writes=writes,
            )

    stdout = stdout_bytes.decode("utf-8", errors="replace")
    stderr = stderr_bytes.decode("utf-8", errors="replace")
    writes = None
    if before_snapshot is not None:
        writes = compare_workspaces(before_snapshot, capture_workspace(task.cwd))
    return result_for(task, command, exit_code, stdout, stderr, writes=writes)


def result_for(
    task: WorkerTask,
    command: list[str],
    exit_code: int | None,
    stdout: str,
    stderr: str,
    *,
    writes: dict[str, Any] | None = None,
) -> dict[str, Any]:
    text = extract_text(stdout)
    diff = extract_diff(text)
    errors = stderr.strip()
    if exit_code not in (0, None) and not errors:
        errors = f"pi exited with code {exit_code}"
    result = {
        "id": task.task_id,
        "role": task.role,
        "route": task.route,
        "alias": task.alias,
        "provider": task.provider,
        "model": task.model,
        "thinking": task.thinking,
        "permission": task.permission,
        "tools": task.tools,
        "model_source": task.model_source,
        "session_id": task.session_id,
        "orchestrator_name": task.orchestrator_name,
        "exit_code": exit_code,
        "summary": summarize(text, diff),
        "diff": diff,
        "raw_output": text,
        "errors": errors,
        "diagnostics": diagnostics_for(task, exit_code, errors),
        "command": shlex.join(command[:-1] + ["<prompt>"]),
    }
    if writes is not None:
        result["writes"] = writes
    return result


async def run_all(tasks: list[WorkerTask], max_concurrency: int) -> list[dict[str, Any]]:
    if any(task.permission == "write" for task in tasks):
        results: list[dict[str, Any]] = []
        semaphore = asyncio.Semaphore(1)
        for task in tasks:
            results.append(await run_task(task, semaphore))
        return results

    semaphore = asyncio.Semaphore(max_concurrency)
    return await asyncio.gather(*(run_task(task, semaphore) for task in tasks))


def effective_max_concurrency(tasks: list[WorkerTask], max_concurrency: int) -> int:
    if any(task.permission == "write" for task in tasks):
        return 1
    return max_concurrency


def dry_run(tasks: list[WorkerTask], max_concurrency: int) -> dict[str, Any]:
    effective_concurrency = effective_max_concurrency(tasks, max_concurrency)
    return {
        "dry_run": True,
        "max_concurrency": effective_concurrency,
        "requested_max_concurrency": max_concurrency,
        "tasks": [
            {
                "id": task.task_id,
                "role": task.role,
                "route": task.route,
                "alias": task.alias,
                "provider": task.provider,
                "model": task.model,
                "thinking": task.thinking,
                "permission": task.permission,
                "tools": task.tools,
                "model_source": task.model_source,
                "session_id": task.session_id,
                "orchestrator_name": task.orchestrator_name,
                "cwd": str(task.cwd),
                "timeout_seconds": task.timeout_seconds,
                "command": shlex.join(command_for(task)[:-1] + ["<prompt>"]),
            }
            for task in tasks
        ],
    }


def main() -> int:
    args = parse_args()
    try:
        spec = load_spec(args.spec)
        tasks, max_concurrency = build_tasks(spec)
        if args.dry_run:
            output = dry_run(tasks, max_concurrency)
        else:
            output = {
                "results": asyncio.run(run_all(tasks, max_concurrency)),
                "max_concurrency": effective_max_concurrency(tasks, max_concurrency),
                "requested_max_concurrency": max_concurrency,
            }
    except SpecError as exc:
        output = {"error": str(exc), "failure_policy": "ask_user_no_auto_fallback"}
        print(json.dumps(output, indent=2), file=sys.stderr)
        return 2

    print(json.dumps(output, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
