import json
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
import home_hot_words  # noqa: E402


class FakeClient:
    def __init__(self, payload):
        self.payload = payload
        self.kwargs = {}

    def chat_structured(self, **_kwargs):
        return {"parsed": self.payload}


def _write_meta(root, day, title, paper_id):
    path = root / "docs" / day[:6] / day[6:] / "papers.meta.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({
        "generated_at": f"{day[:4]}-{day[4:6]}-{day[6:]}T20:00:00Z",
        "papers": [{"paper_id": paper_id, "title_en": title, "abstract_en": "Technical abstract."}],
    }), encoding="utf-8")


def test_pipeline_uses_generated_report_dates_and_deduplicates(tmp_path):
    _write_meta(tmp_path, "20260729", "Future Frame Supervision", "same")
    _write_meta(tmp_path, "20260728", "Duplicate Title", "same")
    _write_meta(tmp_path, "20260712", "Outside Window", "old")
    records, start, end = home_hot_words.load_recent_records(tmp_path / "docs")
    assert [record["id"] for record in records] == ["same"]
    assert start.date().isoformat() == "2026-07-16"
    assert end.date().isoformat() == "2026-07-29"


def test_pipeline_includes_frontier_and_keeps_the_latest_duplicate(tmp_path):
    _write_meta(tmp_path, "20260729", "Daily version", "shared")
    frontier = tmp_path / "docs" / "frontier" / "index.json"
    frontier.parent.mkdir(parents=True, exist_ok=True)
    frontier.write_text(json.dumps({"entries": [
        {"id": "shared", "title": "Older frontier duplicate", "selected_at": "2026-07-28"},
        {"id": "frontier-only", "title": "Frontier signal", "selected_at": "2026-07-27"},
    ]}), encoding="utf-8")
    records, _start, _end = home_hot_words.load_recent_records(tmp_path / "docs")
    assert {record["id"] for record in records} == {"shared", "frontier-only"}
    assert next(record for record in records if record["id"] == "shared")["title"] == "Daily version"


def test_pipeline_writes_only_specific_editorial_topics(tmp_path):
    for index in range(4):
        _write_meta(tmp_path, f"202607{29 - index:02d}", f"Paper {index}", f"p{index}")
    client = FakeClient({"topics": [
        {"phrase_en": "future-frame supervision", "summary_zh": "用未来状态约束表征学习"},
        {"phrase_en": "contact-rich tactile modeling", "summary_zh": "触觉与视觉的接触建模"},
        {"phrase_en": "world-model-guided planning", "summary_zh": "以预测动态辅助规划"},
        {"phrase_en": "latent action pretraining", "summary_zh": "从视频中学习潜在动作"},
        {"phrase_en": "autonomous driving", "summary_zh": "应被过滤"},
    ]})
    written = home_hot_words.refresh_hot_words(tmp_path / "docs", client)
    payload = json.loads(written.read_text(encoding="utf-8"))
    assert payload["generator"] == "deepseek"
    assert len(payload["topics"]) == 4
    assert "autonomous driving" not in {item["phrase_en"] for item in payload["topics"]}


def test_pipeline_accepts_three_topics_and_skips_an_unchanged_fingerprint(tmp_path):
    for index in range(4):
        _write_meta(tmp_path, f"202607{29 - index:02d}", f"Paper {index}", f"p{index}")
    client = FakeClient({"topics": [
        {"phrase_en": "future-frame supervision", "summary_zh": "用未来状态约束表征学习"},
        {"phrase_en": "contact-rich tactile modeling", "summary_zh": "触觉与视觉的接触建模"},
        {"phrase_en": "latent action pretraining", "summary_zh": "从视频中学习潜在动作"},
    ]})
    first = home_hot_words.refresh_hot_words(tmp_path / "docs", client)
    assert first is not None
    assert home_hot_words.refresh_hot_words(tmp_path / "docs", client) is None
    payload = json.loads(first.read_text(encoding="utf-8"))
    assert payload["schema_version"] == 2
    assert payload["input_fingerprint"]
    assert len(payload["topics"]) == 3
