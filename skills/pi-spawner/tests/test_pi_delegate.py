from __future__ import annotations

import importlib.util
import sys
import tempfile
import unittest
from pathlib import Path


SCRIPT_PATH = Path(__file__).resolve().parents[1] / "scripts" / "pi_delegate.py"
SPEC = importlib.util.spec_from_file_location("pi_delegate", SCRIPT_PATH)
assert SPEC and SPEC.loader
pi_delegate = importlib.util.module_from_spec(SPEC)
sys.modules["pi_delegate"] = pi_delegate
SPEC.loader.exec_module(pi_delegate)


class BuildTasksTest(unittest.TestCase):
    def base_spec(self) -> dict:
        return {
            "cwd": str(Path.cwd()),
            "config_path": self.config_path,
            "tasks": [{"id": "t1", "prompt": "Review this change."}],
        }

    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.config_path = str(Path(self.temp_dir.name) / "models.json")
        Path(self.config_path).write_text(
            """{
              "default_route": "code",
              "aliases": {
                "kimi": {"provider": "openrouter", "model": "moonshotai/kimi-k2.6", "thinking": "high"},
                "deepseek": {"provider": "openrouter", "model": "deepseek/deepseek-v3.2", "thinking": "high"},
                "local": {"provider": "openai", "model": "gpt-5", "thinking": "medium"}
              },
              "routes": {
                "code": "kimi",
                "writing": "deepseek",
                "review": "deepseek",
                "design": "local",
                "plan": "kimi"
              }
            }""",
            encoding="utf-8",
        )

    def tearDown(self) -> None:
        self.temp_dir.cleanup()

    def test_route_falls_back_to_config_alias(self) -> None:
        spec = self.base_spec()
        spec["tasks"][0]["route"] = "writing"
        tasks, _ = pi_delegate.build_tasks(spec)
        self.assertEqual(tasks[0].alias, "deepseek")
        self.assertEqual(tasks[0].provider, "openrouter")
        self.assertEqual(tasks[0].model, "deepseek/deepseek-v3.2")
        self.assertEqual(tasks[0].thinking, "high")

    def test_explicit_alias_wins_over_route(self) -> None:
        spec = self.base_spec()
        spec["tasks"][0].update({"route": "writing", "alias": "kimi"})
        tasks, _ = pi_delegate.build_tasks(spec)
        self.assertEqual(tasks[0].alias, "kimi")
        self.assertEqual(tasks[0].model, "moonshotai/kimi-k2.6")

    def test_task_provider_and_thinking_override_alias(self) -> None:
        spec = self.base_spec()
        spec["tasks"][0].update({"alias": "deepseek", "provider": "openai", "thinking": "low"})
        tasks, _ = pi_delegate.build_tasks(spec)
        self.assertEqual(tasks[0].provider, "openai")
        self.assertEqual(tasks[0].thinking, "low")
        self.assertEqual(tasks[0].model, "deepseek/deepseek-v3.2")

    def test_model_suffix_sets_thinking(self) -> None:
        spec = self.base_spec()
        spec["tasks"][0]["model"] = "openai/gpt-5:high"
        tasks, _ = pi_delegate.build_tasks(spec)
        self.assertEqual(tasks[0].provider, "openai")
        self.assertEqual(tasks[0].model, "gpt-5")
        self.assertEqual(tasks[0].thinking, "high")

    def test_unknown_route_is_error(self) -> None:
        spec = self.base_spec()
        spec["tasks"][0]["route"] = "research"
        with self.assertRaises(pi_delegate.SpecError):
            pi_delegate.build_tasks(spec)

    def test_unknown_alias_is_error(self) -> None:
        spec = self.base_spec()
        spec["tasks"][0]["alias"] = "deeepseek"
        with self.assertRaises(pi_delegate.SpecError):
            pi_delegate.build_tasks(spec)

    def test_task_model_wins_over_top_level_alias(self) -> None:
        spec = self.base_spec()
        spec["alias"] = "deepseek"
        spec["tasks"][0]["model"] = "openai/gpt-5:medium"
        tasks, _ = pi_delegate.build_tasks(spec)
        self.assertIsNone(tasks[0].alias)
        self.assertEqual(tasks[0].provider, "openai")
        self.assertEqual(tasks[0].model, "gpt-5")
        self.assertEqual(tasks[0].thinking, "medium")

    def test_top_level_thinking_overrides_alias_when_task_omits_it(self) -> None:
        spec = self.base_spec()
        spec["thinking"] = "low"
        spec["tasks"][0]["alias"] = "kimi"
        tasks, _ = pi_delegate.build_tasks(spec)
        self.assertEqual(tasks[0].thinking, "low")

    def test_task_thinking_wins_over_top_level_thinking(self) -> None:
        spec = self.base_spec()
        spec["thinking"] = "low"
        spec["tasks"][0].update({"alias": "kimi", "thinking": "xhigh"})
        tasks, _ = pi_delegate.build_tasks(spec)
        self.assertEqual(tasks[0].thinking, "xhigh")

    def test_explicit_missing_config_path_is_error(self) -> None:
        spec = self.base_spec()
        spec["config_path"] = str(Path(self.temp_dir.name) / "missing.json")
        with self.assertRaises(pi_delegate.SpecError):
            pi_delegate.build_tasks(spec)


if __name__ == "__main__":
    unittest.main()
