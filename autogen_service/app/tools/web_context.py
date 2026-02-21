from __future__ import annotations

import os
import re
import time
from html import unescape
from typing import Any
from urllib.parse import parse_qs, unquote, urlparse

import httpx

DEFAULT_ALLOWED_DOMAINS = [
    "edu",
    "ac.uk",
    "ac.jp",
    "ac.in",
    "openalex.org",
    "semanticscholar.org",
    "arxiv.org",
    "aclanthology.org",
]

EMAIL_REGEX = re.compile(r"[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}")


def parse_allowed_domains() -> list[str]:
    raw = os.getenv("WEB_ALLOWED_DOMAINS", "").strip()
    if not raw:
        return DEFAULT_ALLOWED_DOMAINS.copy()
    domains = [part.strip().lower() for part in raw.split(",") if part.strip()]
    return domains or DEFAULT_ALLOWED_DOMAINS.copy()


def _guess_university_domain(university: str) -> str | None:
    slug = re.sub(r"[^a-z0-9]+", "", university.lower())
    if not slug:
        return None
    if "university" in slug:
        slug = slug.replace("university", "")
    if not slug:
        return None
    return f"{slug}.edu"


def _extract_real_url(raw_url: str) -> str | None:
    if not raw_url.startswith("http"):
        return None

    parsed = urlparse(raw_url)
    if "duckduckgo.com" not in parsed.netloc:
        return raw_url

    params = parse_qs(parsed.query)
    uddg_values = params.get("uddg")
    if uddg_values:
        return unquote(uddg_values[0])
    return None


def _is_allowed_url(url: str, allowed_domains: list[str]) -> bool:
    try:
        domain = (urlparse(url).netloc or "").lower()
    except Exception:
        return False
    if not domain:
        return False

    for allowed in allowed_domains:
        allowed = allowed.lower()
        if domain == allowed or domain.endswith(f".{allowed}") or domain.endswith(allowed):
            return True
    return False


def _extract_links_from_search_html(html: str) -> list[str]:
    links = re.findall(r'href="([^"]+)"', html, flags=re.IGNORECASE)
    cleaned: list[str] = []
    seen: set[str] = set()
    for link in links:
        real = _extract_real_url(unescape(link))
        if not real:
            continue
        if real in seen:
            continue
        seen.add(real)
        cleaned.append(real)
    return cleaned


def _strip_html(raw_html: str) -> str:
    without_scripts = re.sub(
        r"<(script|style).*?>.*?</\1>", " ", raw_html, flags=re.IGNORECASE | re.DOTALL
    )
    without_tags = re.sub(r"<[^>]+>", " ", without_scripts)
    text = unescape(without_tags)
    text = re.sub(r"\s+", " ", text).strip()
    return text


def _extract_research_interests(text: str) -> list[str]:
    if not text:
        return []
    candidates = re.findall(
        r"(research(?:\s+interests?| areas?)[:\-]\s*[^.]{20,220})",
        text,
        flags=re.IGNORECASE,
    )
    cleaned: list[str] = []
    seen: set[str] = set()
    for item in candidates:
        value = re.sub(r"\s+", " ", item).strip(" -:")
        lower = value.lower()
        if lower in seen:
            continue
        seen.add(lower)
        cleaned.append(value)
    return cleaned[:8]


async def gather_professor_web_context(
    professor_name: str,
    university: str,
    max_steps: int,
    timeout_seconds: int,
    preferred_domains: list[str] | None = None,
) -> dict[str, Any]:
    allowed_domains = parse_allowed_domains()
    if preferred_domains:
        for domain in preferred_domains:
            normalized = domain.lower().strip()
            if normalized and normalized not in allowed_domains:
                allowed_domains.append(normalized)

    guessed_domain = _guess_university_domain(university)
    if guessed_domain and guessed_domain not in allowed_domains:
        allowed_domains.append(guessed_domain)

    queries = [
        f'"{professor_name}" "{university}" faculty profile',
        f'"{professor_name}" "{university}" lab',
        f'"{professor_name}" "{university}" research interests',
    ]

    sources: list[str] = []
    snippets: list[str] = []
    emails: list[str] = []
    interests: list[str] = []
    seen_urls: set[str] = set()
    steps_used = 0
    deadline = time.monotonic() + max(timeout_seconds, 5)

    async with httpx.AsyncClient(
        timeout=httpx.Timeout(timeout_seconds),
        follow_redirects=True,
        headers={
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        },
    ) as client:
        for query in queries:
            if steps_used >= max_steps or time.monotonic() >= deadline:
                break

            search_url = "https://duckduckgo.com/html/"
            response = await client.get(search_url, params={"q": query})
            if response.status_code != 200:
                continue

            links = _extract_links_from_search_html(response.text)
            for link in links:
                if steps_used >= max_steps or time.monotonic() >= deadline:
                    break
                if link in seen_urls:
                    continue
                seen_urls.add(link)
                if not _is_allowed_url(link, allowed_domains):
                    continue

                steps_used += 1
                try:
                    page_response = await client.get(link)
                except Exception:
                    continue
                if page_response.status_code != 200:
                    continue

                text = _strip_html(page_response.text)[:8000]
                if not text:
                    continue

                sources.append(link)
                snippets.append(text[:700])
                emails.extend(EMAIL_REGEX.findall(text))
                interests.extend(_extract_research_interests(text))

    unique_sources = list(dict.fromkeys(sources))
    unique_interests = list(dict.fromkeys(interests))
    unique_emails = list(dict.fromkeys(emails))

    return {
        "sources": unique_sources,
        "snippets": snippets[:max_steps],
        "email": unique_emails[0] if unique_emails else None,
        "researchInterests": unique_interests[:8],
        "webStepsUsed": steps_used,
        "allowedDomainsUsed": allowed_domains,
    }
