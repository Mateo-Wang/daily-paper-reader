#!/usr/bin/env python
"""Static-site helpers for the independent AI frontier weekly selection.

The daily paper pipeline also rewrites ``docs/README.md`` and ``docs/_sidebar.md``.
Keeping the frontier rendering here makes those rewrites idempotent: a normal daily
run can refresh its own cards without dropping the frontier archive or navigation.
"""

from __future__ import annotations

import html
import json
import os
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Iterable, List


FRONTIER_MARKER = "<!-- dpr-frontier-home -->"
SIDEBAR_START = "<!-- dpr-frontier-sidebar:start -->"
SIDEBAR_END = "<!-- dpr-frontier-sidebar:end -->"


def _clean(value: Any) -> str:
    return str(value or "").strip()


def _safe(value: Any) -> str:
    return html.escape(_clean(value), quote=True)


def _read_json(path: Path, default: Any) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError, TypeError):
        return default


def frontier_index_path(docs_dir: str | os.PathLike[str]) -> Path:
    return Path(docs_dir) / "frontier" / "index.json"


def load_frontier_index(docs_dir: str | os.PathLike[str]) -> Dict[str, Any]:
    data = _read_json(frontier_index_path(docs_dir), {})
    if not isinstance(data, dict):
        data = {}
    entries = data.get("entries")
    data["entries"] = entries if isinstance(entries, list) else []
    return data


def _week_sort_key(value: Any) -> tuple[int, int]:
    text = _clean(value)
    match = re.fullmatch(r"(\d{4})-W(\d{1,2})", text)
    if not match:
        return (0, 0)
    return (int(match.group(1)), int(match.group(2)))


def _entries(index: Dict[str, Any]) -> List[Dict[str, Any]]:
    entries = [x for x in index.get("entries", []) if isinstance(x, dict)]
    return sorted(
        entries,
        key=lambda item: (_week_sort_key(item.get("week")), _clean(item.get("selected_at"))),
        reverse=True,
    )


def _frontier_href(entry: Dict[str, Any]) -> str:
    path = _clean(entry.get("path"))
    if path:
        return "#/" + path.lstrip("#/").removesuffix(".md")
    week = _clean(entry.get("week"))
    slug = _clean(entry.get("slug"))
    return f"#/frontier/{week}/{slug}" if week and slug else "#/frontier/README"


def render_frontier_home_panel(docs_dir: str | os.PathLike[str]) -> str:
    """Render the compact homepage module. Empty weeks intentionally stay empty."""
    index = load_frontier_index(docs_dir)
    entries = _entries(index)
    latest_week = _clean(index.get("latest_week"))
    if not latest_week and entries:
        latest_week = _clean(entries[0].get("week"))
    week_entries = [item for item in entries if _clean(item.get("week")) == latest_week][:2]
    count = len(week_entries)
    total = len(entries)
    week_label = latest_week.replace("-W", " 第 ") + " 周" if latest_week else "本周"

    rows: List[str] = []
    if week_entries:
        for item in week_entries:
            why = _clean(item.get("why_cross_domain"))
            why_attr = f' title="{_safe(why)}"' if why else ""
            rows.append(
                '    <li class="dpr-home-frontier-item">'
                f'<a href="{_safe(_frontier_href(item))}"{why_attr}>'
                f'{_safe(item.get("title"))}'
                "</a></li>"
            )
    else:
        rows.append('    <li class="dpr-home-frontier-empty">本周暂无达到入选阈值的跨领域精选。</li>')

    return "\n".join(
        [
            FRONTIER_MARKER,
            '<section class="dpr-home-frontier-card dpr-home-panel" aria-label="AI 前沿">',
            '  <div class="dpr-home-panel-header">',
            '    <h3 class="dpr-home-frontier-title">AI 前沿</h3>',
            '    <a class="dpr-home-frontier-history" href="#/frontier/README">历史精选 <span aria-hidden="true">›</span></a>',
            "  </div>",
            f'  <p class="dpr-home-frontier-summary">本周精选 <strong>{count}</strong> 篇前沿论文 · 累计共推荐 <strong>{total}</strong> 篇前沿论文</p>',
            '  <div class="dpr-home-frontier-week">',
            f'    <span class="dpr-home-frontier-week-label">└─ {_safe(week_label)}</span>',
            "    <ul>",
            *rows,
            "    </ul>",
            "  </div>",
            "</section>",
            FRONTIER_MARKER,
        ]
    )


def replace_frontier_home_module(content: str, docs_dir: str | os.PathLike[str]) -> str:
    panel = render_frontier_home_panel(docs_dir)
    marker_re = re.compile(
        re.escape(FRONTIER_MARKER) + r".*?" + re.escape(FRONTIER_MARKER), re.DOTALL
    )
    if marker_re.search(content):
        return marker_re.sub(panel, content, count=1)
    # Existing sites created before this feature have the old notice before the
    # daily dashboard. Replace that region while retaining the generated dashboard.
    dashboard = '<div class="dpr-home-dashboard-grid">'
    pos = content.find(dashboard)
    if pos >= 0:
        return panel + "\n\n" + content[pos:]
    return panel + ("\n\n" + content.lstrip() if content.strip() else "\n")


def refresh_home_frontier_module(docs_dir: str | os.PathLike[str]) -> Path:
    path = Path(docs_dir) / "README.md"
    try:
        old = path.read_text(encoding="utf-8")
    except OSError:
        old = ""
    path.write_text(replace_frontier_home_module(old, docs_dir), encoding="utf-8")
    return path


def _sidebar_payload(entry: Dict[str, Any]) -> str:
    tags = [{"kind": "query", "label": "frontier"}]
    type_name = _clean(entry.get("type"))
    if type_name:
        tags.append({"kind": "other", "label": type_name})
    payload: Dict[str, Any] = {
        "title": _clean(entry.get("title")),
        "link": _clean(entry.get("url")) or _frontier_href(entry),
        "score": _clean(entry.get("frontier_score")) or "-",
        "tags": tags,
        "evidence": _clean(entry.get("why_cross_domain")),
        "published": _clean(entry.get("published_at")),
        "selection_source": "frontier",
    }
    return html.escape(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), quote=True)


def render_frontier_sidebar_block(docs_dir: str | os.PathLike[str]) -> str:
    index = load_frontier_index(docs_dir)
    by_week: Dict[str, List[Dict[str, Any]]] = {}
    for entry in _entries(index):
        week = _clean(entry.get("week")) or "历史精选"
        by_week.setdefault(week, []).append(entry)

    lines = [SIDEBAR_START, "* AI 前沿"]
    if not by_week:
        lines.append("  * 暂无精选 <!--dpr-frontier:empty-->")
    for week in sorted(by_week, key=_week_sort_key, reverse=True):
        label = week.replace("-W", " 第 ") + " 周" if "-W" in week else week
        lines.append(f"  * {label} <!--dpr-frontier:{week}-->")
        for entry in by_week[week]:
            href = _frontier_href(entry)
            title = _safe(entry.get("title"))
            lines.append(
                "    * "
                f'<a class="dpr-sidebar-item-link dpr-sidebar-item-structured" href="{_safe(href)}" '
                f'data-sidebar-item="{_sidebar_payload(entry)}">{title}</a>'
            )
    lines.append(SIDEBAR_END)
    return "\n".join(lines) + "\n"


def upsert_frontier_sidebar(docs_dir: str | os.PathLike[str]) -> Path:
    path = Path(docs_dir) / "_sidebar.md"
    try:
        current = path.read_text(encoding="utf-8")
    except OSError:
        current = '* <a class="dpr-sidebar-root-link" href="#/">首页</a>\n'

    block = render_frontier_sidebar_block(docs_dir).rstrip("\n")
    marked = re.compile(
        re.escape(SIDEBAR_START) + r".*?" + re.escape(SIDEBAR_END), re.DOTALL
    )
    if marked.search(current):
        updated = marked.sub(block, current, count=1)
    else:
        # A previous version might have emitted an unmarked section. Remove only
        # that top-level section, never daily/conference entries.
        legacy = re.compile(r"(?ms)^\* AI 前沿\n.*?(?=^\* |\Z)")
        current = legacy.sub("", current, count=1)
        insertion = current.find("* Daily Papers")
        if insertion < 0:
            insertion = current.find("* Conference Papers")
        if insertion < 0:
            updated = current.rstrip() + "\n\n" + block + "\n"
        else:
            updated = current[:insertion].rstrip() + "\n\n" + block + "\n\n" + current[insertion:]
    path.write_text(updated.rstrip() + "\n", encoding="utf-8")
    return path


def refresh_frontier_site(docs_dir: str | os.PathLike[str]) -> tuple[Path, Path]:
    """Refresh the two shared surface files after a frontier selection."""
    return refresh_home_frontier_module(docs_dir), upsert_frontier_sidebar(docs_dir)


def iso_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()
