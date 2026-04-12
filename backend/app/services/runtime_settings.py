import json
from pathlib import Path

from app.config import DATA_DIR, MATH_TEACHER_SYSTEM_PROMPT

_RUNTIME_SETTINGS_PATH = DATA_DIR / "runtime_llm_settings.json"


def _default_settings() -> dict[str, str]:
    return {
        "system_prompt": MATH_TEACHER_SYSTEM_PROMPT,
    }


def _normalize_text(value: str) -> str:
    return value.strip()


def get_runtime_llm_settings() -> dict[str, str]:
    defaults = _default_settings()
    if not _RUNTIME_SETTINGS_PATH.exists():
        return defaults

    try:
        payload = json.loads(_RUNTIME_SETTINGS_PATH.read_text(encoding="utf-8"))
    except Exception:
        return defaults

    if not isinstance(payload, dict):
        return defaults

    system_prompt = payload.get("system_prompt")
    normalized_prompt = system_prompt.strip() if isinstance(system_prompt, str) else ""

    return {
        "system_prompt": normalized_prompt or defaults["system_prompt"],
    }


def update_runtime_llm_settings(system_prompt: str) -> dict[str, str]:
    payload = {
        "system_prompt": system_prompt.strip(),
    }
    _RUNTIME_SETTINGS_PATH.parent.mkdir(parents=True, exist_ok=True)
    _RUNTIME_SETTINGS_PATH.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    return payload
