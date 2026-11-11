from types import SimpleNamespace
from unittest import mock

import pytest

from tracker import ai

ROUTE = SimpleNamespace(api_key="test-key", model="test-model", vertex=False)
CONTEXT = {"company": "Acme", "role": "Backend", "days": 3, "round_type": "technical",
           "weak_spots": [{"topic": "sql", "count": 2, "high_count": 1, "advice": ""}]}


def resource(url, title="R", kind="guide", why=""):
    return {"title": title, "url": url, "kind": kind, "why": why}


def ai_plan(resources):
    """What generate_plan gets back from Gemini, with `resources` as given (left out when None)."""
    reply = {"summary": "Plan.", "tasks": [{"day": 1, "topic": "sql", "title": "Joins", "detail": "", "minutes": 30}]}
    if resources is not None:
        reply["resources"] = resources
    with mock.patch.object(ai, "call_gemini", return_value=reply):
        result, source = ai.generate_plan(dict(CONTEXT), route=ROUTE)
    assert source == "ai"
    return result["resources"]


def test_ai_resources_on_trusted_sites_come_first_and_are_marked_as_ai():
    out = ai.clean_resources([
        resource("https://docs.python.org/3/library/itertools.html", kind="docs"),
        resource("https://www.leetcode.com/problems/two-sum/", kind="podcast"),
    ], ["sql"])
    assert [r["url"] for r in out[:2]] == [
        "https://docs.python.org/3/library/itertools.html", "https://www.leetcode.com/problems/two-sum/",
    ]
    assert [r["source"] for r in out] == ["ai", "ai", "curated", "curated", "curated"]
    assert out[1]["kind"] == "article"  # an unknown kind falls back
    assert "https://sqlbolt.com" in [r["url"] for r in out]  # topped up for the plan's topic


@pytest.mark.parametrize("url", [
    "https://evil-prep.example/login",           # not a trusted site
    "https://leetcode.com.evil.example/login",   # trusted name as a prefix of another host
    "https://leetcode.com@evil.example/login",   # trusted name as userinfo
    "https://evilleetcode.com",                  # trusted name as a suffix without a dot
    "https://evil.example\\.leetcode.com/login",  # browsers read the host as evil.example
    "https://evil.example\t.leetcode.com/login",  # browsers strip tabs and newlines
    "https://evil.example\n.leetcode.com/login",
    "https://leetcode.com/two sum",              # whitespace anywhere
    "https://leetcode.com/two​sum",         # an invisible zero-width space
    "https://leetcode.com/two sum",         # a non-breaking space
    "https://leetcode.com:8443/login",           # a port
    "https://leetcode%2Ecom/login",              # percent-encoded host
    "https://wiki.python.org/moin/FrontPage",    # user-written subdomain of a trusted site
    "https://forum.freecodecamp.org/t/anything",
    "https://github.com/someone/phishing",       # open hosting site, not an exact curated URL
    "javascript:alert(1)",
    "https:///no-host",
    "https://[::1",                              # malformed host
    "https://leetcode.com/" + "a" * 600,         # too long to store whole
])
def test_untrusted_or_unusable_ai_links_are_dropped(url):
    out = ai.clean_resources([resource(url)], ["sql"])
    assert url not in [r["url"] for r in out]
    assert all(r["source"] == "curated" for r in out) and len(out) == 5


@pytest.mark.parametrize("url", ["https://www.python.org", "https://www.rust-lang.org/learn"])
def test_home_pages_the_prompt_falls_back_to_are_trusted(url):
    assert ai.clean_resources([resource(url)], [])[0]["url"] == url


def test_an_exact_curated_url_on_an_open_hosting_site_is_kept():
    out = ai.clean_resources([resource("https://github.com/donnemartin/system-design-primer/")], [])
    assert out[0]["source"] == "ai"


def test_links_that_differ_only_in_formatting_count_once():
    out = ai.clean_resources([resource("https://SQLBolt.com/"), resource("https://www.sqlbolt.com")], ["sql"])
    urls = [r["url"] for r in out]
    assert urls[0] == "https://SQLBolt.com/"
    assert "https://www.sqlbolt.com" not in urls and "https://sqlbolt.com" not in urls  # nor the curated copy
    assert len(out) == 5


def test_malformed_items_are_skipped_not_fatal():
    out = ai.clean_resources(["just a string", None, {"title": 5, "url": "https://leetcode.com"},
                              {"title": "No url"}, {"title": "OK", "url": "https://leetcode.com", "why": 3}], [])
    assert out[0] == {"title": "OK", "url": "https://leetcode.com", "kind": "article", "why": "", "source": "ai"}
    assert len(out) == 5


def test_ai_resources_are_capped_at_five():
    given = [resource(f"https://leetcode.com/problems/p{i}/", title=f"R{i}") for i in range(8)]
    assert [r["title"] for r in ai.clean_resources(given, [])] == ["R0", "R1", "R2", "R3", "R4"]


@pytest.mark.parametrize("topic, first", [
    ("nosql", "Use The Index, Luke"),
    ("sql", "SQLBolt"),
    ("graphs and trees", "NeetCode roadmap"),
    ("STAR stories", "Tech Interview Handbook: behavioral interviews"),
    ("Scaling: caching, queues, sharding", "The System Design Primer"),
])
def test_topics_match_on_whole_words(topic, first):
    assert ai.curated_resources([topic])[0]["title"] == first


@pytest.mark.parametrize("topic", ["graphql apis", "startup pitch"])
def test_topics_dont_match_inside_other_words(topic):
    # Nothing in the library matches, so these get the general resources only.
    assert ai.curated_resources([topic]) == [{**r, "source": "curated"} for r in ai.GENERAL_RESOURCES]


def test_curated_resources_alternate_between_topics():
    out = ai.curated_resources(["sql", "system design"])
    assert [r["url"] for r in out[:2]] == ["https://sqlbolt.com", "https://github.com/donnemartin/system-design-primer"]


def test_generate_plan_keeps_trusted_ai_resources_and_drops_planted_ones():
    out = ai_plan([resource("https://evil-prep.example/login", title="Planted"),
                   resource("https://www.postgresql.org/docs/current/queries.html", title="Postgres queries")])
    assert [r["title"] for r in out][0] == "Postgres queries"
    assert "Planted" not in [r["title"] for r in out]
    assert len(out) == 5


@pytest.mark.parametrize("resources", [None, [], "not a list", [None, 42]])
def test_generate_plan_still_gives_five_resources_when_the_ai_gives_none_usable(resources):
    out = ai_plan(resources)
    assert len(out) == 5 and all(r["source"] == "curated" for r in out)
    assert out[0]["url"] == "https://sqlbolt.com"
