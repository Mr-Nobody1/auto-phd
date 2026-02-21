from __future__ import annotations

import os
from dataclasses import dataclass

from autogen_ext.models.openai import OpenAIChatCompletionClient


@dataclass
class ModelSettings:
    api_key: str
    base_url: str
    model: str
    timeout_seconds: int = 90
    max_retries: int = 2


def get_model_settings() -> ModelSettings:
    api_key = os.getenv("GEMINI_API_KEY", "").strip()
    if not api_key:
        raise RuntimeError("GEMINI_API_KEY is required")

    base_url = (
        os.getenv("GEMINI_OPENAI_BASE_URL", "").strip()
        or "https://generativelanguage.googleapis.com/v1beta/openai/"
    )
    model = os.getenv("AUTOGEN_MODEL", "").strip() or "gemini-2.0-flash"

    return ModelSettings(
        api_key=api_key,
        base_url=base_url,
        model=model,
        timeout_seconds=int(os.getenv("WEB_TIMEOUT_SECONDS", "90")),
        max_retries=2,
    )


def create_model_client(settings: ModelSettings) -> OpenAIChatCompletionClient:
    return OpenAIChatCompletionClient(
        model=settings.model,
        api_key=settings.api_key,
        base_url=settings.base_url.rstrip("/") + "/",
        timeout=settings.timeout_seconds,
        max_retries=settings.max_retries,
        model_info={
            "vision": True,
            "function_calling": True,
            "json_output": True,
            "family": "unknown",
            "structured_output": True,
        }
    )
