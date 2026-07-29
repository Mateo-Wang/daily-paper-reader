#!/usr/bin/env python3
"""Migrate historical Daily Paper Reader tags from ``query:ar``.

The migration uses the new topic boundary: papers explicitly centered on
autonomous driving are labelled ``query:driving``; all other historical
recommendations belong to ``query:robotics``.  It updates every persisted
representation that powers the generated site, so the paper page, metadata,
daily state, sidebar, and archived recommendation payloads stay in sync.
"""

from __future__ import annotations

import argparse
import html
import json
import re
from collections import Counter
from pathlib import Path
from typing import Any


ROOT_DIR = Path(__file__).resolve().parents[1]
ARCHIVE_DIR = ROOT_DIR / "archive"
DOCS_DIR = ROOT_DIR / "docs"
LEGACY_TAGS = {"query:ar", "keyword:ar"}

# These phrases identify a paper whose actual application target is driving,
# rather than a generic robotics paper that happens to cite driving work.
DRIVING_RE = re.compile(
    r"\b(?:"
    r"autonomous[ -]driving|"
    r"self[ -]driving|"
    r"automated[ -]driving|"
    r"end[ -]to[ -]end[ -]autonomous[ -]driving|"
    r"autonomous vehicles?|"
    r"autonomous cars?|"
    r"autonomous valet parking|"
    r"ego vehicles?|"
    r"driving scenes?|"
    r"traffic scenarios?"
    r")\b",
    re.IGNORECASE,
)
ROBOTICS_TITLE_RE = re.compile(
    r"\b(?:robot(?:ics|ic)?|manipulation|humanoid|quadruped|tactile|teleoperation)\b",
    re.IGNORECASE,
)


def load_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, payload: Any, *, apply: bool) -> bool:
    rendered = json.dumps(payload, ensure_ascii=False, indent=2) + "\n"
    if path.read_text(encoding="utf-8") == rendered:
        return False
    if apply:
        path.write_text(rendered, encoding="utf-8")
    return True


def classify_paper(title: str, abstract: str) -> tuple[str, str]:
    """Return the target tag and a terse audit reason.

    A driving phrase in the title is definitive.  A phrase seen only in the
    abstract is treated as a driving paper unless the title explicitly names a
    robotics platform/task; this prevents papers such as broad robot benchmarks
    that merely mention autonomous driving in related work from being moved.
    """

    title_text = str(title or "")
    full_text = f"{title_text}\n{abstract or ''}"
    if DRIVING_RE.search(title_text):
        return "driving", "driving-anchor-in-title"
    if DRIVING_RE.search(full_text) and not ROBOTICS_TITLE_RE.search(title_text):
        return "driving", "driving-anchor-in-abstract"
    return "robotics", "robotics-default"


def replace_tag_values(value: Any, target: str) -> Any:
    new_tag = f"query:{target}"
    if isinstance(value, list):
        rest = [str(item) for item in value if str(item) not in LEGACY_TAGS]
        return [new_tag, *rest] if new_tag not in rest else rest
    if isinstance(value, str):
        return new_tag if value in LEGACY_TAGS or not value.strip() else value
    return [new_tag]


def retag_archive_payloads(*, apply: bool) -> tuple[dict[str, str], Counter[str], list[tuple[str, str, str]]]:
    tag_by_paper_id: dict[str, str] = {}
    counts: Counter[str] = Counter()
    audit: list[tuple[str, str, str]] = []

    for path in sorted(ARCHIVE_DIR.glob("**/recommend/*.json")):
        payload = load_json(path)
        changed = False
        for section in ("deep_dive", "quick_skim"):
            for paper in payload.get(section) or []:
                if not isinstance(paper, dict):
                    continue
                paper_id = str(paper.get("id") or paper.get("paper_id") or "").strip()
                if not paper_id:
                    continue
                target, reason = classify_paper(paper.get("title") or "", paper.get("abstract") or "")
                tag_by_paper_id[paper_id] = target
                counts[target] += 1
                audit.append((paper_id, target, reason))
                for field in ("tags", "llm_tags"):
                    next_value = replace_tag_values(paper.get(field), target)
                    if paper.get(field) != next_value:
                        paper[field] = next_value
                        changed = True
                if paper.get("matched_query_tag") in LEGACY_TAGS:
                    paper["matched_query_tag"] = f"query:{target}"
                    changed = True
        if changed:
            write_json(path, payload, apply=apply)

    return tag_by_paper_id, counts, audit


def retag_daily_state_files(tag_by_paper_id: dict[str, str], *, apply: bool) -> dict[str, str]:
    route_tags: dict[str, str] = {}
    for path in sorted(DOCS_DIR.glob("**/_daily_state.json")):
        payload = load_json(path)
        changed = False
        for paper in payload.get("papers") or []:
            if not isinstance(paper, dict):
                continue
            paper_id = str(paper.get("paper_id") or "").strip()
            target = tag_by_paper_id.get(paper_id)
            if not target:
                target, _ = classify_paper(paper.get("title") or "", "")
            next_tags = [{"kind": "query", "label": target}]
            if paper.get("tags") != next_tags:
                paper["tags"] = next_tags
                changed = True
            route = str(paper.get("route") or "").strip().lstrip("/")
            if route:
                route_tags[route] = target
        if changed:
            write_json(path, payload, apply=apply)
    return route_tags


def retag_meta_files(tag_by_paper_id: dict[str, str], *, apply: bool) -> None:
    for path in sorted(DOCS_DIR.glob("**/papers.meta.json")):
        payload = load_json(path)
        changed = False
        for paper in payload.get("papers") or []:
            if not isinstance(paper, dict):
                continue
            paper_id = str(paper.get("paper_id") or "").strip()
            target = tag_by_paper_id.get(paper_id)
            if not target:
                target, _ = classify_paper(paper.get("title_en") or "", paper.get("abstract_en") or "")
            next_tags = f"query:{target}"
            if paper.get("tags") != next_tags:
                paper["tags"] = next_tags
                changed = True
        if changed:
            write_json(path, payload, apply=apply)


def retag_carryover_cache(tag_by_paper_id: dict[str, str], *, apply: bool) -> Counter[str]:
    """Split the legacy ``ar`` carryover pool into the two new query pools.

    Carryover is read by the next daily run.  Leaving its former single ``ar``
    state intact would reintroduce the old tag even after the published pages
    had been migrated.
    """

    path = ARCHIVE_DIR / "carryover.json"
    if not path.exists():
        return Counter()

    payload = load_json(path)
    tag_states = payload.get("tag_states")
    if not isinstance(tag_states, dict) or "ar" not in tag_states:
        return Counter()

    legacy_state = tag_states.get("ar")
    if not isinstance(legacy_state, dict):
        return Counter()

    new_states: dict[str, dict[str, Any]] = {
        target: {key: value for key, value in legacy_state.items() if key != "items"}
        for target in ("driving", "robotics")
    }
    new_states["driving"]["items"] = []
    new_states["robotics"]["items"] = []
    counts: Counter[str] = Counter()

    for paper in legacy_state.get("items") or []:
        if not isinstance(paper, dict):
            continue
        paper_id = str(paper.get("id") or paper.get("paper_id") or "").strip()
        target = tag_by_paper_id.get(paper_id)
        if not target:
            target, _ = classify_paper(paper.get("title") or "", paper.get("abstract") or "")
        migrated = dict(paper)
        migrated["tags"] = replace_tag_values(migrated.get("tags"), target)
        migrated["llm_tags"] = replace_tag_values(migrated.get("llm_tags"), target)
        if migrated.get("matched_query_tag") in LEGACY_TAGS:
            migrated["matched_query_tag"] = f"query:{target}"
        new_states[target]["items"].append(migrated)
        counts[target] += 1

    # There are currently no non-legacy states, but preserve them if a later
    # migration is run against a partially updated cache.
    merged_states = {key: value for key, value in tag_states.items() if key != "ar"}
    for target, state in new_states.items():
        existing = merged_states.get(target)
        if isinstance(existing, dict) and existing.get("items"):
            state["items"] = [*existing["items"], *state["items"]]
        merged_states[target] = state
    payload["tag_states"] = merged_states
    write_json(path, payload, apply=apply)
    return counts


def retag_markdown_files(route_tags: dict[str, str], *, apply: bool) -> int:
    changed_count = 0
    for route, target in route_tags.items():
        path = DOCS_DIR / f"{route}.md"
        if not path.exists():
            continue
        text = path.read_text(encoding="utf-8")
        updated, replacements = re.subn(
            r"(?m)^tags:\s*\[[^\n]*\]\s*$",
            f'tags: ["query:{target}"]',
            text,
            count=1,
        )
        if replacements and updated != text:
            changed_count += 1
            if apply:
                path.write_text(updated, encoding="utf-8")
    return changed_count


def retag_sidebar(route_tags: dict[str, str], *, apply: bool) -> bool:
    path = DOCS_DIR / "_sidebar.md"
    text = path.read_text(encoding="utf-8")

    def replace_anchor(match: re.Match[str]) -> str:
        anchor = match.group(0)
        href_match = re.search(r'href="#/([^\"]+)"', anchor)
        if not href_match:
            return anchor
        target = route_tags.get(href_match.group(1))
        if not target:
            return anchor
        return anchor.replace(
            '&quot;kind&quot;: &quot;query&quot;, &quot;label&quot;: &quot;ar&quot;',
            f'&quot;kind&quot;: &quot;query&quot;, &quot;label&quot;: &quot;{target}&quot;',
        )

    updated = re.sub(r"<a\b[^>]*data-sidebar-item=\"[^\"]*\"[^>]*>.*?</a>", replace_anchor, text)
    if updated == text:
        return False
    if apply:
        path.write_text(updated, encoding="utf-8")
    return True


def main() -> None:
    parser = argparse.ArgumentParser(description="Retag historical ar recommendations as driving or robotics.")
    parser.add_argument("--apply", action="store_true", help="Write the migration; omit for a dry run.")
    args = parser.parse_args()

    tag_by_paper_id, counts, audit = retag_archive_payloads(apply=args.apply)
    carryover_counts = retag_carryover_cache(tag_by_paper_id, apply=args.apply)
    route_tags = retag_daily_state_files(tag_by_paper_id, apply=args.apply)
    retag_meta_files(tag_by_paper_id, apply=args.apply)
    markdown_count = retag_markdown_files(route_tags, apply=args.apply)
    sidebar_changed = retag_sidebar(route_tags, apply=args.apply)

    mode = "APPLIED" if args.apply else "DRY RUN"
    print(f"[{mode}] archive papers: {sum(counts.values())} ({dict(sorted(counts.items()))})")
    print(f"[{mode}] carryover papers: {sum(carryover_counts.values())} ({dict(sorted(carryover_counts.items()))})")
    print(f"[{mode}] daily paper routes: {len(route_tags)}; markdown pages: {markdown_count}; sidebar changed: {sidebar_changed}")
    for paper_id, target, reason in audit:
        if target == "driving":
            print(f"[driving] {paper_id} ({reason})")


if __name__ == "__main__":
    main()
