import json
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

import frontier  # noqa: E402
from frontier_site import load_frontier_index, refresh_frontier_site  # noqa: E402


def _candidate(title, url, score, published="2026-07-25"):
    return {
        "title": title,
        "url": url,
        "abstract": "A broadly useful AI advance for models, agents and representation learning.",
        "published_at": published,
        "type": "论文",
        "sources": ["arXiv"],
        "frontier_score": score,
        "why_cross_domain": "它会影响多个 AI 子领域的模型、数据和评测范式。",
        "evidence": "来自公开技术材料与跨社区关注信号。",
    }


def test_candidate_dedup_normalizes_arxiv_pdf_and_abs_urls():
    candidates = frontier.merge_candidates(
        [
            _candidate("Same Paper", "https://arxiv.org/abs/2607.12345v1", 9.2),
            _candidate("Same Paper (PDF)", "https://arxiv.org/pdf/2607.12345v1.pdf", 9.2),
        ]
    )
    assert len(candidates) == 1
    assert frontier.candidate_key(candidates[0]) == "arxiv:2607.12345v1"


def test_weekly_selection_never_exceeds_two_and_respects_global_history(monkeypatch):
    candidates = [
        _candidate("Frontier A", "https://example.com/a", 9.7),
        _candidate("Frontier B", "https://example.org/b", 9.4),
        _candidate("Frontier C", "https://example.net/c", 9.1),
    ]
    monkeypatch.setattr(frontier, "score_candidates_with_llm", lambda values: values)
    index = {"entries": []}
    selected = frontier.select_weekly(candidates, index, "2026-W31")
    assert [item["title"] for item in selected] == ["Frontier A", "Frontier B"]
    index["entries"] = [{"canonical_key": frontier.candidate_key(selected[0]), "week": "2026-W30"}]
    selected_again = frontier.select_weekly(candidates, index, "2026-W31")
    assert all(item["title"] != "Frontier A" for item in selected_again)
    assert len(selected_again) <= 2


def test_generated_site_has_home_card_sidebar_search_payload_and_archive(tmp_path):
    docs = tmp_path / "docs"
    docs.mkdir(parents=True)
    (docs / "README.md").write_text('<div class="dpr-home-dashboard-grid">daily</div>\n', encoding="utf-8")
    (docs / "_sidebar.md").write_text('* <a href="#/">首页</a>\n\n* Daily Papers\n', encoding="utf-8")
    index = {"entries": []}
    selected = [
        _candidate("Foundation Model Breakthrough", "https://example.com/foundation", 9.5),
        _candidate("Open Agent Release", "https://example.org/agent", 9.1),
        _candidate("Third Must Not Appear", "https://example.net/third", 9.0),
    ]
    written = frontier.write_selected_entries(selected[:2], index, docs, "2026-W31")
    index["latest_week"] = "2026-W31"
    frontier.save_index(index, docs)
    frontier.write_archive_readme(index, docs)
    refresh_frontier_site(docs)

    home = (docs / "README.md").read_text(encoding="utf-8")
    sidebar = (docs / "_sidebar.md").read_text(encoding="utf-8")
    archive = (docs / "frontier" / "README.md").read_text(encoding="utf-8")
    assert "AI 前沿" in home and "本周精选 <strong>2</strong>" in home
    assert "累计共推荐 <strong>2</strong>" in home
    assert "AI 前沿" in sidebar and "dpr-frontier:2026-W31" in sidebar
    assert "data-sidebar-item=" in sidebar and "frontier" in sidebar
    assert "Foundation Model Breakthrough" in archive
    assert len(written) == 2
    assert load_frontier_index(docs)["entries"][0]["path"].startswith("frontier/2026-W31/")
