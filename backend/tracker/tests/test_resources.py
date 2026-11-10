from tracker import ai


def test_ai_resources_keep_good_links_and_top_up_from_the_curated_list():
    given = [
        {"title": "Official docs", "url": "https://docs.example.com/guide", "kind": "docs", "why": "Canonical."},
        {"title": "Duplicate", "url": "https://docs.example.com/guide", "kind": "docs", "why": ""},
        {"title": "Script", "url": "javascript:alert(1)", "kind": "guide", "why": ""},
        {"title": "No host", "url": "https:///path", "kind": "guide", "why": ""},
        {"title": "", "url": "https://untitled.example.com", "kind": "guide", "why": ""},
        {"title": "Odd kind", "url": "http://blog.example.com", "kind": "podcast", "why": "x"},
    ]
    out = ai.clean_resources(given, ["sql"])
    urls = [r["url"] for r in out]
    assert urls[:2] == ["https://docs.example.com/guide", "http://blog.example.com"]
    assert out[1]["kind"] == "article"
    assert len(out) == 5 and len(set(urls)) == 5
    assert "https://sqlbolt.com" in urls  # topped up for the plan's topic


def test_ai_resources_are_capped_at_five():
    given = [{"title": f"R{i}", "url": f"https://r{i}.example.com", "kind": "guide", "why": ""} for i in range(8)]
    assert [r["title"] for r in ai.clean_resources(given, [])] == ["R0", "R1", "R2", "R3", "R4"]


def test_curated_resources_alternate_between_topics_and_always_fill_five():
    out = ai.curated_resources(["sql", "system design"])
    assert [r["url"] for r in out[:2]] == ["https://sqlbolt.com", "https://github.com/donnemartin/system-design-primer"]
    assert len(ai.curated_resources(["something obscure"])) == 5
