#!/usr/bin/env python
"""Independent, deliberately sparse AI-frontier weekly selection pipeline.

This is not another subscription tag.  It collects broad, cross-domain candidates
into a rolling 30-day pool, globally de-duplicates them, and selects at most two
items per ISO week.  It is safe to run repeatedly: the candidate store, weekly
selection and generated Docsify navigation are all idempotent.

Supported collection adapters
-----------------------------
* arXiv Atom API (AI/ML/CV/CL/robotics/multimodal-adjacent categories)
* Hugging Face public models API
* GitHub public repository search API
* configurable official/vendor RSS feeds (``FRONTIER_RSS_FEEDS`` JSON)
* optional X API recent search (``X_BEARER_TOKEN`` + ``FRONTIER_X_QUERIES`` JSON)

RSS and X are deliberately opt-in: no brittle browser scraping and no secret is
stored in this repository.  The weekly workflow exposes the needed environment
variables through GitHub Actions secrets.
"""

from __future__ import annotations

import argparse
import hashlib
import html
import json
import os
import re
import sys
import time
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, Iterable, List, Sequence
from urllib.parse import quote_plus, urlparse

import requests

from frontier_site import iso_now, refresh_frontier_site


SCRIPT_DIR = Path(__file__).resolve().parent
ROOT_DIR = SCRIPT_DIR.parent
DEFAULT_DAYS = 30
MAX_WEEKLY = 2
ARXIV_API = "https://export.arxiv.org/api/query"
HF_MODELS_API = "https://huggingface.co/api/models"
GITHUB_SEARCH_API = "https://api.github.com/search/repositories"
X_RECENT_SEARCH_API = "https://api.x.com/2/tweets/search/recent"

# Broad enough to discover important work outside the two research subscriptions,
# but deliberately no ordinary daily-paper scoring/tagging occurs here.
ARXIV_QUERIES = (
    "cat:cs.AI OR cat:cs.LG OR cat:stat.ML",
    "cat:cs.CV OR cat:cs.CL OR cat:cs.HC",
    "cat:cs.RO OR cat:cs.MA OR cat:cs.SE",
)
GITHUB_QUERIES = (
    "topic:large-language-model",
    "topic:machine-learning",
    "topic:multimodal",
)


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def log(message: str) -> None:
    print(f"[{utc_now().strftime('%Y-%m-%d %H:%M:%S UTC')}] [frontier] {message}", flush=True)


def clean(value: Any) -> str:
    return str(value or "").strip()


def parse_datetime(value: Any) -> datetime | None:
    text = clean(value)
    if not text:
        return None
    for candidate in (text, text.replace("Z", "+00:00")):
        try:
            parsed = datetime.fromisoformat(candidate)
            return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)
        except ValueError:
            pass
    for fmt in ("%Y-%m-%d", "%a, %d %b %Y %H:%M:%S %z", "%a, %d %b %Y %H:%M:%S GMT"):
        try:
            parsed = datetime.strptime(text, fmt)
            return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)
        except ValueError:
            pass
    return None


def iso_date(value: Any) -> str:
    parsed = parse_datetime(value)
    return parsed.date().isoformat() if parsed else clean(value)[:10]


def normalize_title(value: Any) -> str:
    text = clean(value).lower()
    text = re.sub(r"[^\w]+", " ", text, flags=re.UNICODE)
    return re.sub(r"\s+", " ", text).strip()


def canonical_url(value: Any) -> str:
    url = clean(value)
    if not url:
        return ""
    url = re.sub(r"[?#].*$", "", url).rstrip("/")
    url = url.replace("http://", "https://")
    url = re.sub(r"https://arxiv\.org/(pdf|abs)/([^/]+)$", r"https://arxiv.org/abs/\2", url)
    return url


def arxiv_id_from_url(url: str) -> str:
    match = re.search(r"arxiv\.org/(?:abs|pdf)/([^/?#]+)", clean(url), re.I)
    return match.group(1).removesuffix(".pdf") if match else ""


def candidate_key(candidate: Dict[str, Any]) -> str:
    arxiv_id = clean(candidate.get("arxiv_id")) or arxiv_id_from_url(clean(candidate.get("url")))
    if arxiv_id:
        return "arxiv:" + arxiv_id.lower()
    doi = clean(candidate.get("doi")).lower()
    if doi:
        return "doi:" + doi.removeprefix("https://doi.org/")
    # Vendor pages, model cards and repositories frequently use different URLs
    # for one launch.  A normalized substantive title is the stable cross-site
    # identity in that case; source URLs are merged as evidence below.
    title = normalize_title(candidate.get("title"))
    if len(title) >= 12:
        return "title:" + title
    url = canonical_url(candidate.get("url"))
    if url:
        return "url:" + url.lower()
    return "title:" + title


def stable_id(candidate: Dict[str, Any]) -> str:
    return hashlib.sha256(candidate_key(candidate).encode("utf-8")).hexdigest()[:16]


def slugify(title: Any, fallback: str) -> str:
    ascii_title = clean(title).lower()
    ascii_title = re.sub(r"[^a-z0-9]+", "-", ascii_title).strip("-")
    return (ascii_title[:96].strip("-") or fallback).strip("-")


def parse_json_env(name: str, default: Any) -> Any:
    raw = clean(os.getenv(name))
    if not raw:
        return default
    try:
        value = json.loads(raw)
        return value if isinstance(value, type(default)) else default
    except ValueError:
        log(f"[WARN] {name} is not valid JSON; ignored")
        return default


def http_get(url: str, *, params: Dict[str, Any] | None = None, headers: Dict[str, str] | None = None, timeout: int = 30) -> requests.Response:
    response = requests.get(url, params=params, headers=headers, timeout=timeout)
    response.raise_for_status()
    return response


def candidate_from_mapping(raw: Dict[str, Any], source: str = "manual") -> Dict[str, Any] | None:
    title = clean(raw.get("title") or raw.get("name"))
    url = canonical_url(raw.get("url") or raw.get("html_url") or raw.get("link"))
    if not title or not url:
        return None
    source_types = raw.get("sources")
    sources = [clean(x) for x in source_types] if isinstance(source_types, list) else []
    if source and source not in sources:
        sources.append(source)
    return {
        "id": clean(raw.get("id")),
        "title": title,
        "url": url,
        "abstract": clean(raw.get("abstract") or raw.get("summary") or raw.get("description")),
        "published_at": iso_date(raw.get("published_at") or raw.get("published") or raw.get("date") or raw.get("created_at") or utc_now().date().isoformat()),
        "updated_at": iso_date(raw.get("updated_at") or raw.get("lastModified") or raw.get("date") or ""),
        "type": clean(raw.get("type")) or "论文",
        "source_urls": [canonical_url(x) for x in raw.get("source_urls", []) if canonical_url(x)] if isinstance(raw.get("source_urls"), list) else [],
        "sources": sources,
        "arxiv_id": clean(raw.get("arxiv_id")),
        "doi": clean(raw.get("doi")),
        "metrics": raw.get("metrics") if isinstance(raw.get("metrics"), dict) else {},
        "collected_at": iso_now(),
    }


def collect_arxiv(limit_per_query: int = 60) -> List[Dict[str, Any]]:
    results: List[Dict[str, Any]] = []
    ns = {"a": "http://www.w3.org/2005/Atom"}
    for query in ARXIV_QUERIES:
        try:
            response = http_get(
                ARXIV_API,
                params={
                    "search_query": query,
                    "start": 0,
                    "max_results": limit_per_query,
                    "sortBy": "submittedDate",
                    "sortOrder": "descending",
                },
            )
            root = ET.fromstring(response.text)
            for entry in root.findall("a:entry", ns):
                link = clean(entry.findtext("a:id", default="", namespaces=ns))
                title = " ".join(clean(entry.findtext("a:title", default="", namespaces=ns)).split())
                summary = " ".join(clean(entry.findtext("a:summary", default="", namespaces=ns)).split())
                arxiv_id = arxiv_id_from_url(link)
                item = candidate_from_mapping(
                    {
                        "title": title,
                        "url": link,
                        "abstract": summary,
                        "published_at": entry.findtext("a:published", default="", namespaces=ns),
                        "updated_at": entry.findtext("a:updated", default="", namespaces=ns),
                        "arxiv_id": arxiv_id,
                        "type": "论文",
                        "source_urls": [link],
                    },
                    "arXiv",
                )
                if item:
                    results.append(item)
        except Exception as exc:
            log(f"[WARN] arXiv collection failed for query={query!r}: {exc}")
    return results


def collect_huggingface(limit: int = 60) -> List[Dict[str, Any]]:
    try:
        response = http_get(HF_MODELS_API, params={"sort": "trendingScore", "direction": -1, "limit": limit, "full": "true"})
        payload = response.json()
    except Exception as exc:
        log(f"[WARN] Hugging Face collection failed: {exc}")
        return []
    items: List[Dict[str, Any]] = []
    for raw in payload if isinstance(payload, list) else []:
        if not isinstance(raw, dict) or not clean(raw.get("modelId")):
            continue
        model_id = clean(raw.get("modelId"))
        item = candidate_from_mapping(
            {
                "title": model_id,
                "url": f"https://huggingface.co/{model_id}",
                "abstract": clean(raw.get("cardData", {}).get("description")) if isinstance(raw.get("cardData"), dict) else "",
                "published_at": raw.get("createdAt") or raw.get("lastModified"),
                "updated_at": raw.get("lastModified"),
                "type": "模型发布",
                "metrics": {
                    "downloads": raw.get("downloads") or 0,
                    "likes": raw.get("likes") or 0,
                    "trending_score": raw.get("trendingScore") or 0,
                },
            },
            "Hugging Face",
        )
        if item:
            items.append(item)
    return items


def collect_github(limit_per_query: int = 30) -> List[Dict[str, Any]]:
    headers = {"Accept": "application/vnd.github+json"}
    token = clean(os.getenv("GITHUB_TOKEN"))
    if token:
        headers["Authorization"] = f"Bearer {token}"
    since = (utc_now() - timedelta(days=DEFAULT_DAYS)).date().isoformat()
    items: List[Dict[str, Any]] = []
    for query in GITHUB_QUERIES:
        try:
            response = http_get(
                GITHUB_SEARCH_API,
                params={"q": f"{query} pushed:>{since}", "sort": "stars", "order": "desc", "per_page": limit_per_query},
                headers=headers,
            )
            payload = response.json()
            for raw in payload.get("items", []) if isinstance(payload, dict) else []:
                if not isinstance(raw, dict):
                    continue
                item = candidate_from_mapping(
                    {
                        "title": raw.get("full_name"),
                        "url": raw.get("html_url"),
                        "abstract": raw.get("description"),
                        "published_at": raw.get("created_at") or raw.get("updated_at"),
                        "updated_at": raw.get("pushed_at") or raw.get("updated_at"),
                        "type": "开源项目",
                        "metrics": {
                            "stars": raw.get("stargazers_count") or 0,
                            "forks": raw.get("forks_count") or 0,
                        },
                    },
                    "GitHub",
                )
                if item:
                    items.append(item)
        except Exception as exc:
            log(f"[WARN] GitHub collection failed for query={query!r}: {exc}")
    return items


def _rss_text(node: ET.Element, names: Sequence[str]) -> str:
    for name in names:
        found = node.find(name)
        if found is not None and clean(found.text):
            return clean(found.text)
    return ""


def collect_rss(feeds: Sequence[Dict[str, Any]]) -> List[Dict[str, Any]]:
    items: List[Dict[str, Any]] = []
    for feed in feeds:
        if not isinstance(feed, dict) or not clean(feed.get("url")):
            continue
        name = clean(feed.get("name")) or "官方发布"
        try:
            root = ET.fromstring(http_get(clean(feed["url"])).content)
            channel_items = root.findall(".//item")
            atom_entries = root.findall("{http://www.w3.org/2005/Atom}entry")
            for node in channel_items:
                link = _rss_text(node, ("link", "{http://www.w3.org/2005/Atom}link"))
                item = candidate_from_mapping(
                    {
                        "title": _rss_text(node, ("title",)),
                        "url": link,
                        "abstract": _rss_text(node, ("description", "{http://purl.org/rss/1.0/modules/content/}encoded")),
                        "published_at": _rss_text(node, ("pubDate", "date")),
                        "type": clean(feed.get("type")) or "技术报告",
                        "source_urls": [clean(feed["url"])],
                    },
                    name,
                )
                if item:
                    items.append(item)
            for node in atom_entries:
                link_node = node.find("{http://www.w3.org/2005/Atom}link")
                link = clean(link_node.get("href")) if link_node is not None else ""
                item = candidate_from_mapping(
                    {
                        "title": _rss_text(node, ("{http://www.w3.org/2005/Atom}title",)),
                        "url": link,
                        "abstract": _rss_text(node, ("{http://www.w3.org/2005/Atom}summary", "{http://www.w3.org/2005/Atom}content")),
                        "published_at": _rss_text(node, ("{http://www.w3.org/2005/Atom}published", "{http://www.w3.org/2005/Atom}updated")),
                        "type": clean(feed.get("type")) or "技术报告",
                        "source_urls": [clean(feed["url"])],
                    },
                    name,
                )
                if item:
                    items.append(item)
        except Exception as exc:
            log(f"[WARN] RSS collection failed for {name}: {exc}")
    return items


def collect_x_posts(queries: Sequence[str], limit: int = 20) -> List[Dict[str, Any]]:
    token = clean(os.getenv("X_BEARER_TOKEN"))
    if not token or not queries:
        return []
    items: List[Dict[str, Any]] = []
    headers = {"Authorization": f"Bearer {token}"}
    for query in queries:
        try:
            response = http_get(
                X_RECENT_SEARCH_API,
                params={"query": clean(query), "max_results": min(max(limit, 10), 100), "tweet.fields": "created_at,public_metrics"},
                headers=headers,
            )
            for post in response.json().get("data", []):
                if not isinstance(post, dict):
                    continue
                post_id = clean(post.get("id"))
                item = candidate_from_mapping(
                    {
                        "title": "X 发布：" + " ".join(clean(post.get("text")).split())[:140],
                        "url": f"https://x.com/i/web/status/{post_id}",
                        "abstract": post.get("text"),
                        "published_at": post.get("created_at"),
                        "type": "技术发布",
                        "metrics": post.get("public_metrics") or {},
                    },
                    "X",
                )
                if item:
                    items.append(item)
        except Exception as exc:
            log(f"[WARN] X collection failed for query={query!r}: {exc}")
    return items


def merge_candidates(items: Iterable[Dict[str, Any]]) -> List[Dict[str, Any]]:
    by_key: Dict[str, Dict[str, Any]] = {}
    for raw in items:
        item = candidate_from_mapping(raw, source="")
        if not item:
            continue
        item["id"] = clean(raw.get("id")) or stable_id(item)
        key = candidate_key(item)
        existing = by_key.get(key)
        if not existing:
            by_key[key] = item
            continue
        existing["sources"] = sorted(set(existing.get("sources", [])) | set(item.get("sources", [])))
        existing["source_urls"] = sorted(set(existing.get("source_urls", [])) | set(item.get("source_urls", [])))
        if len(clean(item.get("abstract"))) > len(clean(existing.get("abstract"))):
            existing["abstract"] = item.get("abstract", "")
        for metric, value in (item.get("metrics") or {}).items():
            try:
                existing.setdefault("metrics", {})[metric] = max(float(existing.get("metrics", {}).get(metric) or 0), float(value or 0))
            except (TypeError, ValueError):
                pass
        old_date = parse_datetime(existing.get("published_at"))
        new_date = parse_datetime(item.get("published_at"))
        if new_date and (not old_date or new_date < old_date):
            existing["published_at"] = iso_date(new_date.isoformat())
    return list(by_key.values())


def pool_path(root: Path = ROOT_DIR) -> Path:
    return root / "archive" / "frontier" / "candidates.json"


def load_pool(root: Path = ROOT_DIR) -> List[Dict[str, Any]]:
    path = pool_path(root)
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
        return raw.get("candidates", []) if isinstance(raw, dict) and isinstance(raw.get("candidates"), list) else []
    except (OSError, ValueError):
        return []


def save_pool(candidates: Iterable[Dict[str, Any]], root: Path = ROOT_DIR) -> Path:
    path = pool_path(root)
    path.parent.mkdir(parents=True, exist_ok=True)
    merged = merge_candidates(candidates)
    merged.sort(key=lambda item: (parse_datetime(item.get("published_at")) or datetime.min.replace(tzinfo=timezone.utc)), reverse=True)
    path.write_text(json.dumps({"updated_at": iso_now(), "candidates": merged}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return path


def rolling_candidates(candidates: Iterable[Dict[str, Any]], days: int = DEFAULT_DAYS, now: datetime | None = None) -> List[Dict[str, Any]]:
    now = now or utc_now()
    cutoff = now - timedelta(days=max(1, int(days)))
    result: List[Dict[str, Any]] = []
    for item in candidates:
        published = parse_datetime(item.get("published_at")) or parse_datetime(item.get("collected_at"))
        if published and published >= cutoff:
            result.append(item)
    return merge_candidates(result)


def get_week(value: str | None = None) -> str:
    if value and re.fullmatch(r"\d{4}-W\d{1,2}", value):
        year, week = value.split("-W", 1)
        return f"{int(year):04d}-W{int(week):02d}"
    iso = utc_now().isocalendar()
    return f"{iso.year:04d}-W{iso.week:02d}"


def load_index(docs_dir: Path) -> Dict[str, Any]:
    path = docs_dir / "frontier" / "index.json"
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        if isinstance(data, dict):
            data["entries"] = data.get("entries") if isinstance(data.get("entries"), list) else []
            return data
    except (OSError, ValueError):
        pass
    return {"schema_version": 1, "entries": []}


def save_index(index: Dict[str, Any], docs_dir: Path) -> Path:
    path = docs_dir / "frontier" / "index.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    index["schema_version"] = 1
    index["updated_at"] = iso_now()
    path.write_text(json.dumps(index, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return path


def impact_prior(candidate: Dict[str, Any]) -> float:
    """Cheap first-pass ranking; LLM makes the final editorial decision."""
    title = normalize_title(candidate.get("title"))
    abstract = normalize_title(candidate.get("abstract"))
    text = title + " " + abstract
    score = 0.0
    high_signal = ("reasoning", "foundation model", "large language", "multimodal", "vision language", "world model", "agent", "robot", "diffusion", "representation", "dino", "reinforcement", "open source")
    score += sum(0.5 for token in high_signal if token in text)
    source_bonus = {"arXiv": 0.5, "GitHub": 0.7, "Hugging Face": 0.7, "官方发布": 1.0}.get(clean((candidate.get("sources") or [""])[0]), 0.0)
    score += source_bonus
    metrics = candidate.get("metrics") or {}
    try:
        score += min(2.5, float(metrics.get("stars") or 0) / 2000.0)
        score += min(1.5, float(metrics.get("likes") or 0) / 500.0)
        score += min(1.5, float(metrics.get("downloads") or 0) / 100000.0)
    except (TypeError, ValueError):
        pass
    return score


def score_candidates_with_llm(candidates: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Annotate a small shortlist with an editorial score. Safe deterministic fallback."""
    ordered = sorted(candidates, key=impact_prior, reverse=True)[:48]
    api_key = clean(os.getenv("DEEPSEEK_API_KEY") or os.getenv("SUMMARY_API_KEY"))
    if not api_key or not ordered:
        for item in ordered:
            item["frontier_score"] = round(min(8.4, 5.8 + impact_prior(item) * 0.72), 1)
            item["why_cross_domain"] = "候选已进入跨领域前沿池；等待模型评审后才会入选每周精选。"
        return ordered

    try:
        from llm import DeepSeekClient

        base_url = clean(os.getenv("DEEPSEEK_BASE_URL") or os.getenv("SUMMARY_BASE_URL")) or "https://api.deepseek.com"
        model = clean(os.getenv("SUMMARY_MODEL") or os.getenv("DEEPSEEK_MODEL")) or "deepseek-v4-flash"
        payload = [
            {
                "id": item["id"], "title": item["title"], "type": item["type"], "source": item.get("sources", []),
                "abstract": clean(item.get("abstract"))[:1200], "metrics": item.get("metrics", {}), "published_at": item.get("published_at", ""),
            }
            for item in ordered
        ]
        prompt = (
            "你是 AI 前沿周报的严苛编辑。仅选择会影响多个 AI 子领域、由重要实验室/公司发布、"
            "或可能形成长期技术拐点的候选。不要因为与自动驾驶或机器人相关就加分；普通增量论文一律低分。"
            "对每个候选返回 JSON 数组，每项字段：id, score(0-10), why_cross_domain(一句中文), evidence(一句中文), "
            "core_contribution(一句中文), limitations(一句中文), driving_relevance(一句中文), robotics_relevance(一句中文)。\n"
            + json.dumps(payload, ensure_ascii=False)
        )
        client = DeepSeekClient(api_key=api_key, model=model, base_url=base_url)
        client.kwargs.update({"temperature": 0.15, "max_tokens": 12000})
        response = client.chat(messages=[{"role": "system", "content": "只输出合法 JSON。"}, {"role": "user", "content": prompt}])
        text = clean(response.get("content"))
        text = re.sub(r"^```(?:json)?\s*|\s*```$", "", text, flags=re.I)
        annotation = json.loads(text)
        annotations = {clean(x.get("id")): x for x in annotation if isinstance(x, dict)} if isinstance(annotation, list) else {}
        for item in ordered:
            meta = annotations.get(item["id"], {})
            try:
                item["frontier_score"] = round(float(meta.get("score")), 1)
            except (TypeError, ValueError):
                item["frontier_score"] = round(min(8.4, 5.8 + impact_prior(item) * 0.72), 1)
            for field in ("why_cross_domain", "evidence", "core_contribution", "limitations", "driving_relevance", "robotics_relevance"):
                if clean(meta.get(field)):
                    item[field] = clean(meta[field])
        return ordered
    except Exception as exc:
        log(f"[WARN] LLM frontier scoring failed; no item will auto-pass the fallback: {exc}")
        for item in ordered:
            item["frontier_score"] = round(min(8.4, 5.8 + impact_prior(item) * 0.72), 1)
            item.setdefault("why_cross_domain", "模型评审暂不可用，本候选不会自动进入精选。")
        return ordered


def select_weekly(candidates: List[Dict[str, Any]], index: Dict[str, Any], week: str) -> List[Dict[str, Any]]:
    existing = [x for x in index.get("entries", []) if isinstance(x, dict) and clean(x.get("week")) == week]
    existing_keys = {clean(x.get("canonical_key")) for x in index.get("entries", []) if isinstance(x, dict)}
    remaining = max(0, MAX_WEEKLY - len(existing))
    if not remaining:
        return []
    shortlist = score_candidates_with_llm(candidates)
    eligible = [item for item in shortlist if candidate_key(item) not in existing_keys and float(item.get("frontier_score") or 0) >= 8.5]
    eligible.sort(key=lambda item: (float(item.get("frontier_score") or 0), impact_prior(item)), reverse=True)
    selected: List[Dict[str, Any]] = []
    seen_domains: set[str] = set()
    for item in eligible:
        domain = urlparse(clean(item.get("url"))).netloc.lower()
        # Prefer a diversified pair where quality is tied; it avoids two copies of
        # the same announcement from one platform dominating the weekly card.
        if domain and domain in seen_domains and len(eligible) > remaining:
            continue
        seen_domains.add(domain)
        selected.append(item)
        if len(selected) >= remaining:
            break
    return selected


def detail_markdown(entry: Dict[str, Any]) -> str:
    sources = entry.get("sources") or []
    source_urls = entry.get("source_urls") or []
    source_label = " / ".join(clean(x) for x in sources if clean(x)) or "公开来源"
    primary = clean(entry.get("url"))
    all_links = [primary] + [clean(x) for x in source_urls if clean(x) and clean(x) != primary]
    links = " · ".join(f"[{html.escape(url)}]({url})" for url in all_links) or "—"
    title = clean(entry.get("title"))
    summary = clean(entry.get("abstract")) or "该发布未提供可稳定解析的摘要；请参阅原始来源。"
    return "\n".join(
        [
            f"# {title}",
            "",
            f"**Tags**: `frontier`",
            "",
            f"**本周前沿**: {clean(entry.get('week'))}",
            "",
            f"**类型**: {clean(entry.get('type')) or '论文'}",
            "",
            f"**来源**: {source_label}",
            "",
            f"**发布日期**: {clean(entry.get('published_at')) or '—'}",
            "",
            f"**前沿评分**: {clean(entry.get('frontier_score')) or '—'} / 10",
            "",
            f"**原始链接**: {links}",
            "",
            "## 为什么值得跨领域阅读",
            "",
            clean(entry.get("why_cross_domain")) or "它被作为跨领域候选跟踪；只有达到严格影响力阈值才会进入本周精选。",
            "",
            "## 概述",
            "",
            summary,
            "",
            "## 核心贡献",
            "",
            clean(entry.get("core_contribution")) or "请以原始论文、技术报告或模型卡为准。",
            "",
            "## 证据与影响信号",
            "",
            clean(entry.get("evidence")) or "公开发布渠道、技术内容与社区信号共同构成候选判断；这不是引用量预测。",
            "",
            "## 局限与阅读提示",
            "",
            clean(entry.get("limitations")) or "该页面是高层导读，实际能力、训练成本与可复现性仍需阅读原始材料验证。",
            "",
            "## 与你的研究方向的连接",
            "",
            f"- 自动驾驶：{clean(entry.get('driving_relevance')) or '未假定直接相关；重点关注其对感知、规划、世界模型或训练范式的可迁移性。'}",
            f"- 机器人：{clean(entry.get('robotics_relevance')) or '未假定直接相关；重点关注其对具身学习、控制、VLA 或数据规模化的可迁移性。'}",
            "",
        ]
    )


def write_selected_entries(selected: List[Dict[str, Any]], index: Dict[str, Any], docs_dir: Path, week: str) -> List[Dict[str, Any]]:
    written: List[Dict[str, Any]] = []
    for item in selected:
        canonical = candidate_key(item)
        identifier = clean(item.get("id")) or stable_id(item)
        slug = slugify(item.get("title"), identifier)
        path = docs_dir / "frontier" / week / f"{slug}.md"
        sequence = 2
        while path.exists() and canonical not in {clean(x.get("canonical_key")) for x in index.get("entries", []) if isinstance(x, dict)}:
            path = docs_dir / "frontier" / week / f"{slug}-{sequence}.md"
            sequence += 1
        entry = dict(item)
        entry.update({
            "id": identifier,
            "slug": path.stem,
            "week": week,
            "path": str(path.relative_to(docs_dir)).replace(os.sep, "/").removesuffix(".md"),
            "canonical_key": canonical,
            "selected_at": iso_now(),
        })
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(detail_markdown(entry), encoding="utf-8")
        index.setdefault("entries", []).append(entry)
        written.append(entry)
    return written


def write_archive_readme(index: Dict[str, Any], docs_dir: Path) -> Path:
    entries = [x for x in index.get("entries", []) if isinstance(x, dict)]
    by_week: Dict[str, List[Dict[str, Any]]] = {}
    for entry in entries:
        by_week.setdefault(clean(entry.get("week")) or "历史精选", []).append(entry)
    lines = ["# AI 前沿", "", "每周最多两篇：只保留值得跨领域阅读的论文、技术报告、模型发布或开源项目。", ""]
    if not by_week:
        lines.extend(["当前还没有入选条目。", ""])
    for week in sorted(by_week, key=lambda item: tuple(map(int, re.findall(r"\d+", item) or [0, 0])), reverse=True):
        label = week.replace("-W", " 第 ") + " 周" if "-W" in week else week
        lines.extend([f"## {label}", ""])
        for entry in by_week[week]:
            title = clean(entry.get("title"))
            href = clean(entry.get("path"))
            reason = clean(entry.get("why_cross_domain"))
            lines.append(f"- [{title}](#/{href})  ")
            if reason:
                lines.append(f"  {reason}")
        lines.append("")
    path = docs_dir / "frontier" / "README.md"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(lines), encoding="utf-8")
    return path


def collect_all(*, network: bool = True, input_path: Path | None = None) -> List[Dict[str, Any]]:
    items: List[Dict[str, Any]] = []
    if input_path:
        raw = json.loads(input_path.read_text(encoding="utf-8"))
        values = raw.get("candidates", raw) if isinstance(raw, dict) else raw
        if isinstance(values, list):
            items.extend(x for x in values if isinstance(x, dict))
    if network:
        items.extend(collect_arxiv())
        items.extend(collect_huggingface())
        items.extend(collect_github())
        items.extend(collect_rss(parse_json_env("FRONTIER_RSS_FEEDS", [])))
        items.extend(collect_x_posts(parse_json_env("FRONTIER_X_QUERIES", [])))
    return merge_candidates(items)


def run(args: argparse.Namespace) -> int:
    root = Path(args.root).resolve()
    docs_dir = root / "docs"
    week = get_week(args.week)
    existing_pool = load_pool(root)
    collected = collect_all(network=not args.no_network, input_path=Path(args.input).resolve() if args.input else None)
    pool = rolling_candidates(existing_pool + collected, days=args.window_days)
    pool_file = save_pool(pool, root)
    log(f"candidate pool: {len(pool)} in rolling {args.window_days}-day window ({pool_file.relative_to(root)})")
    if args.collect_only:
        return 0

    index = load_index(docs_dir)
    selected = select_weekly(pool, index, week)
    written = write_selected_entries(selected, index, docs_dir, week)
    index["latest_week"] = week
    save_index(index, docs_dir)
    archive = write_archive_readme(index, docs_dir)
    home, sidebar = refresh_frontier_site(docs_dir)
    log(f"weekly selection: week={week}, added={len(written)}, total={len(index.get('entries', []))}")
    log(f"site refreshed: {home.relative_to(root)}, {sidebar.relative_to(root)}, {archive.relative_to(root)}")
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Collect and publish sparse weekly AI frontier selections")
    parser.add_argument("--root", default=str(ROOT_DIR), help="Repository root (for tests/local runs)")
    parser.add_argument("--week", default="", help="ISO week, e.g. 2026-W31; defaults to current UTC ISO week")
    parser.add_argument("--window-days", type=int, default=DEFAULT_DAYS, help="Rolling candidate window; default 30")
    parser.add_argument("--input", default="", help="Optional local JSON candidates for deterministic/manual runs")
    parser.add_argument("--no-network", action="store_true", help="Do not call arXiv/HF/GitHub/RSS/X adapters")
    parser.add_argument("--collect-only", action="store_true", help="Update only the candidate pool, not weekly selection")
    return parser


if __name__ == "__main__":
    raise SystemExit(run(build_parser().parse_args()))
