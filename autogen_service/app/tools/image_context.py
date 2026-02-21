from __future__ import annotations

import base64
import json
from typing import Any
from urllib.parse import urljoin

import httpx


def _extract_json(text: str) -> dict[str, Any]:
    text = text.strip()
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        start = text.find("{")
        end = text.rfind("}")
        if start >= 0 and end > start:
            return json.loads(text[start : end + 1])
        raise


async def analyze_context_image(
    image_bytes: bytes | None,
    content_type: str | None,
    filename: str | None,
    *,
    api_key: str,
    model: str,
    base_url: str,
    timeout_seconds: int = 45,
) -> dict[str, Any]:
    if not image_bytes:
        return {"available": False}

    safe_content_type = content_type or "image/png"
    encoded = base64.b64encode(image_bytes).decode("ascii")
    data_url = f"data:{safe_content_type};base64,{encoded}"
    endpoint = urljoin(base_url.rstrip("/") + "/", "chat/completions")

    prompt = (
        "Analyze this image as supporting context for a PhD application outreach workflow. "
        "Extract concise, actionable information only.\n\n"
        "Return strict JSON with this shape:\n"
        "{\n"
        '  "available": true,\n'
        '  "summary": "1-2 sentence summary",\n'
        '  "visualClues": ["clue 1", "clue 2"],\n'
        '  "possibleResearchSignals": ["signal 1", "signal 2"],\n'
        '  "confidence": "high|medium|low"\n'
        "}\n"
    )

    payload = {
        "model": model,
        "temperature": 0.1,
        "response_format": {"type": "json_object"},
        "messages": [
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": prompt},
                    {"type": "image_url", "image_url": {"url": data_url}},
                ],
            }
        ],
    }

    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}

    async with httpx.AsyncClient(timeout=timeout_seconds) as client:
        response = await client.post(endpoint, headers=headers, json=payload)
        response.raise_for_status()
        data = response.json()

    content = (
        (((data.get("choices") or [{}])[0]).get("message") or {}).get("content") or "{}"
    )
    parsed = _extract_json(content)
    parsed["available"] = True
    parsed["filename"] = filename
    return parsed
