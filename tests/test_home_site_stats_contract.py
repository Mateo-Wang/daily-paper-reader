from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
NOTICE_FILES = (
    ROOT / "docs_init" / "_home_notice.md",
    ROOT / "docs_init" / "README.md",
)

HOME_README_FILES = (
    ROOT / "docs_init" / "README.md",
)

PROMO_FILES = (
    ROOT / "docs_init" / "_home_promo.md",
    ROOT / "docs_init" / "README.md",
)


def test_home_frontier_module_replaces_notice_and_keeps_archive_entry():
    for path in NOTICE_FILES:
        content = path.read_text(encoding="utf-8")
        assert "AI 前沿" in content, path
        assert "历史精选" in content, path
        assert "本周精选" in content, path
        assert "累计共推荐" in content, path
        assert 'href="#/frontier/README"' in content, path
        assert "dpr-frontier-home" in content, path
        assert "公告与更新" not in content, path


def test_home_hot_words_replaces_community_promo_with_a_stable_panel_target():
    for path in PROMO_FILES:
        content = path.read_text(encoding="utf-8")
        assert 'class="dpr-home-hotwords-card dpr-home-panel"' in content, path
        assert "data-dpr-home-hotwords" in content, path
        assert 'class="dpr-home-panel-header"' in content, path
        assert "AI 精选研究主题" in content, path
        assert "DEEPSEEK CURATED" in content, path
        assert "AI 前沿" in content, path
        assert "QQ群" not in content and "社区与支持" not in content, path


def test_home_panel_modules_are_embedded_in_the_init_homepage():
    readme = (ROOT / "docs_init" / "README.md").read_text(encoding="utf-8")
    notice = (ROOT / "docs_init" / "_home_notice.md").read_text(encoding="utf-8").strip()
    promo = (ROOT / "docs_init" / "_home_promo.md").read_text(encoding="utf-8").strip()
    assert notice in readme
    assert promo in readme


def test_site_stats_script_remains_loaded_for_other_pages_without_home_target():
    html = (ROOT / "index.html").read_text(encoding="utf-8")
    assert "app/site-stats.js" in html
    assert "app/home-hot-words.js" in html
    assert "[DPR] 首页增强加载失败" in html


def test_home_frontier_css_has_desktop_and_mobile_layouts():
    css = (ROOT / "app" / "app.css").read_text(encoding="utf-8")
    assert ".dpr-home-panel-header" in css
    assert ".dpr-home-frontier-card" in css
    assert ".dpr-home-frontier-summary" in css
    assert ".dpr-home-frontier-week" in css
    assert ".dpr-home-frontier-item" in css
    assert "font-variant-numeric: tabular-nums" in css
    assert "@media (max-width: 600px)" in css


def test_home_panels_share_a_quiet_visual_language():
    css = (ROOT / "app" / "app.css").read_text(encoding="utf-8")
    shared_selector = (
        ".markdown-section .dpr-home-notice-card,\n"
        ".markdown-section .dpr-home-frontier-card,\n"
        ".markdown-section .dpr-home-promo-card,\n"
        ".markdown-section .dpr-home-hotwords-card"
    )
    assert shared_selector in css

    shared_rule = css.split(shared_selector, 1)[1].split("}", 1)[0]
    assert "background: #fbfcfb" in shared_rule
    assert "border: 1px solid #dfe7e2" in shared_rule
    assert "border-left" not in shared_rule
    assert "border-radius: 6px" in shared_rule
    assert "box-shadow: none" in shared_rule
    assert "gradient" not in shared_rule

    assert ".dpr-home-panel-header" in css
    assert ".dpr-home-frontier-week" in css
    assert ".dpr-home-hotwords-cloud" in css
    assert ".dpr-home-hot-topic" in css
    assert ".dpr-home-hotwords-eyebrow" in css

    panel_section = css.split("/* 首页信息面板", 1)[1].split("/* 侧边栏字体放大", 1)[0]
    # 信息面板本体保持克制；词云的加载占位允许使用局部 shimmer 动效。
    assert "gradient" not in shared_rule
    assert "::before" not in panel_section
    assert "::after" not in panel_section


def test_supabase_site_reader_stats_sql_is_least_privilege():
    sql = (ROOT / "sql" / "create_site_reader_stats_schema.sql").read_text(encoding="utf-8").lower()

    assert "create table if not exists public.site_daily_reader_events" in sql
    assert "create table if not exists public.site_daily_reader_counts" in sql
    assert "alter table public.site_daily_reader_events enable row level security" in sql
    assert "alter table public.site_daily_reader_counts enable row level security" in sql
    assert "create schema if not exists private" in sql
    assert "create or replace function private.increment_site_daily_reader_count" in sql
    assert "security definer" in sql
    assert "set search_path = ''" in sql
    assert "grant insert on public.site_daily_reader_events to anon, authenticated" in sql
    assert "grant select on public.site_daily_reader_counts to anon, authenticated" in sql
    assert "for insert" in sql and "with check" in sql
    assert "asia/shanghai" in sql
    assert "visitor_hash ~ '^[a-f0-9]{64}$'" in sql
    assert "grant select on public.site_daily_reader_events to anon" not in sql
