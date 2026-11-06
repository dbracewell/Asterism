"""US-59.1: bounded team-pack parsing, credential screening and the published schema."""

import copy
import json
import time
from pathlib import Path

import pytest
from asterism.core.exceptions import BadDataException
from asterism.domains.packs.documents import (
    MAX_PACK_BYTES,
    MAX_SUB_AGENTS,
    PACK_FORMAT,
    PackManifest,
    pack_json_schema,
    parse_pack,
    serialize_pack,
)

SCHEMA_PATH = Path(__file__).resolve().parents[3] / "docs" / "schemas" / "team-pack-v1.schema.json"
SKILL = "---\nname: cite-sources\ndescription: Cite every claim.\n---\nCite every claim you make.\n"
TEMPLATE = {
    "name": "Summary",
    "description": "Summarize a topic.",
    "fields": [{"kind": "short_text", "key": "topic", "label": "Topic"}],
    "body": "Summarize {{topic}}.",
}
RUBRIC = {
    "name": "Essay",
    "description": "Essay rubric.",
    "levels": ["Strong", "Weak"],
    "criteria": [{"label": "Thesis", "descriptors": ["Clear", "Unclear"]}],
}


def manifest() -> dict:
    return {
        "format": PACK_FORMAT,
        "format_version": 1,
        "pack": {"id": "research-team", "version": "1.2.0", "name": "Research team"},
        "sub_agents": [
            {
                "key": "researcher",
                "name": "Researcher",
                "instructions": "Find sources.",
                "max_steps": 8,
                "generation": {"temperature": 1, "max_tokens": 2000},
                "requested_tools": ["web_search"],
                "model_requirements": {"tools": True, "vision": True, "min_context_window": 32000},
            }
        ],
        "skills": [{"key": "cite", "content": SKILL, "request_main_agent_assignment": True}],
        "templates": [{"key": "summary", "document": TEMPLATE}],
        "rubrics": [{"key": "essay", "document": RUBRIC}],
        "project": {"name": "Research", "accent": "teal", "sub_agents": ["researcher"]},
    }


def encode(data: object) -> bytes:
    return json.dumps(data).encode("utf-8")


def rejected(data: object) -> str:
    with pytest.raises(BadDataException) as error:
        parse_pack(data if isinstance(data, bytes) else encode(data))
    return str(error.value)


def changed(edit) -> dict:
    data = copy.deepcopy(manifest())
    edit(data)
    return data


def test_valid_pack_parses_and_round_trips():
    parsed = parse_pack(encode(manifest()))
    assert parsed.pack.id == "research-team"
    assert parsed.sub_agents[0].model_requirements.min_context_window == 32000
    assert parsed.sub_agents[0].generation.max_tokens == 2000
    assert parse_pack(serialize_pack(parsed)) == parsed


def test_pack_with_only_a_template_is_valid():
    data = manifest()
    parsed = parse_pack(encode({key: data[key] for key in ("format", "format_version", "pack", "templates")}))
    assert parsed.sub_agents == () and parsed.project is None


def test_empty_pack_is_rejected():
    data = manifest()
    assert "at least one item" in rejected({key: data[key] for key in ("format", "format_version", "pack")})


@pytest.mark.parametrize(
    ("edit", "message"),
    [
        (lambda d: d.update(format="other"), "format must be"),
        (lambda d: d.update(format_version=2), "Unsupported pack format version"),
        (lambda d: d.update(format_version=True), "Unsupported pack format version"),
        (lambda d: d.update(format_version="1"), "Unsupported pack format version"),
    ],
)
def test_unknown_format_is_rejected(edit, message):
    assert message in rejected(changed(edit))


@pytest.mark.parametrize("section", ["files", "mcp_servers", "tools", "providers", "memories"])
def test_unknown_item_types_are_rejected(section):
    assert section in rejected(changed(lambda d: d.update({section: []})))


@pytest.mark.parametrize("field", ["model_id", "model", "id", "user_id", "tools", "skills"])
def test_sub_agents_cannot_carry_bindings_or_grants(field):
    assert field in rejected(changed(lambda d: d["sub_agents"][0].update({field: "x"})))


@pytest.mark.parametrize(
    "field",
    ["api_key", "apiKey", "APIKEY", "client_secret", "password", "auth_token", "refreshToken", "authorization"],
)
@pytest.mark.parametrize("target", ["root", "agent", "generation"])
def test_credential_shaped_fields_are_rejected(field, target):
    holders = {
        "root": lambda d: d,
        "agent": lambda d: d["sub_agents"][0],
        "generation": lambda d: d["sub_agents"][0]["generation"],
    }
    message = rejected(changed(lambda d: holders[target](d).update({field: "value"})))
    assert "credential-shaped" in message and "value" not in message.replace("credential-shaped field", "")


@pytest.mark.parametrize(
    "secret",
    [
        "sk-" + "a1B2" * 12,
        "sk-proj-" + "a1B2" * 12,
        "ghp_" + "a1B2" * 10,
        "AKIA" + "ABCDEFGH23456789",
        "xoxb-1234567890-abcdefghij",
        "Authorization: Bearer " + "a1B2" * 10,
        "-----BEGIN RSA PRIVATE KEY-----",
        "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NSJ9.c2lnbmF0dXJlLWJ5dGVz",
        "postgres://admin:hunter2@db.internal/app",
    ],
)
def test_credential_shaped_values_are_rejected_without_being_echoed(secret):
    message = rejected(changed(lambda d: d["sub_agents"][0].update(instructions=f"Use {secret} please.")))
    assert "looks like a credential" in message and "instructions" in message
    assert secret not in message


@pytest.mark.parametrize(
    "text",
    [
        "Never ask the user for an API key, password or secret token.",
        "Send the header Authorization: Bearer <token>.",
        "Assess the task-based learning approach and its risk-management framework.",
        "See https://example.com/a:b for details.",
    ],
)
def test_prose_about_credentials_is_allowed(text):
    parse_pack(encode(changed(lambda d: d["sub_agents"][0].update(instructions=text))))


def test_credentials_are_screened_in_nested_documents():
    message = rejected(changed(lambda d: d["templates"][0]["document"].update(body="ghp_" + "a1B2" * 10)))
    assert "$.templates[0].document.body" in message


def test_size_is_bounded_before_decoding():
    assert "exceeds" in rejected(b" " * (MAX_PACK_BYTES + 1))


def test_nesting_is_bounded():
    deep: object = "x"
    for _ in range(20):
        deep = [deep]
    assert "levels of nesting" in rejected(changed(lambda d: d.update(extra=deep)))
    assert "levels of nesting" in rejected(b"[" * 500_000)


@pytest.mark.parametrize(
    ("source", "message"),
    [
        (b"\xff\xfe", "valid UTF-8"),
        (b"{", "valid JSON"),
        (b"[]", "JSON object"),
        (b'{"format": 1, "format": 2}', "duplicate fields"),
        (b'{"x": NaN}', "NaN"),
    ],
)
def test_malformed_sources_are_rejected(source, message):
    assert message in rejected(source)


@pytest.mark.parametrize("text", ["bad\u0000text", "bad\ud800text"])
def test_unsafe_text_is_rejected(text):
    source = json.dumps(changed(lambda d: d["sub_agents"][0].update(instructions=text))).encode()
    assert "Pack text at" in rejected(source)


def test_item_count_is_bounded():
    def edit(data):
        agent = data["sub_agents"][0]
        data["sub_agents"] = [{**agent, "key": f"agent-{i}", "name": f"Agent {i}"} for i in range(MAX_SUB_AGENTS + 1)]

    assert "sub_agents" in rejected(changed(edit))


def test_values_are_not_coerced():
    assert "max_steps" in rejected(changed(lambda d: d["sub_agents"][0].update(max_steps="8")))
    assert "request_main_agent_assignment" in rejected(
        changed(lambda d: d["skills"][0].update(request_main_agent_assignment=1))
    )


@pytest.mark.parametrize("tool", ["sub_agent", "search_knowledge"])
def test_internal_tools_cannot_be_requested(tool):
    assert "internal tool" in rejected(changed(lambda d: d["sub_agents"][0].update(requested_tools=[tool])))


def test_requested_tools_must_be_stated_as_a_requirement():
    def edit(data):
        data["sub_agents"][0]["model_requirements"]["tools"] = False

    assert "model requirements" in rejected(changed(edit))


def test_duplicate_requested_tools_are_rejected():
    tools = ["web_search", "web_search"]
    assert "requested tools" in rejected(changed(lambda d: d["sub_agents"][0].update(requested_tools=tools)))


@pytest.mark.parametrize(
    ("section", "field", "message"),
    [
        ("sub_agents", "key", "sub-agent keys"),
        ("sub_agents", "name", "sub-agent names"),
        ("skills", "key", "skill keys"),
        ("skills", "name", "skill names"),
        ("templates", "key", "template keys"),
        ("templates", "name", "template names"),
        ("rubrics", "key", "rubric keys"),
        ("rubrics", "name", "rubric names"),
    ],
)
def test_items_must_be_unique_within_a_section(section, field, message):
    def edit(data):
        item = copy.deepcopy(data[section][0])
        if field == "name":
            item["key"] = "other"
        elif section == "sub_agents":
            item["name"] = "Other"
        data[section].append(item)

    assert message in rejected(changed(edit))


@pytest.mark.parametrize(
    ("edit", "message"),
    [
        (lambda d: d["skills"][0].update(content="no frontmatter"), "Pack item 'cite'"),
        (lambda d: d["templates"][0]["document"].update(body="No placeholder."), "Pack item 'summary'"),
        (lambda d: d["rubrics"][0]["document"]["criteria"][0].update(descriptors=["a", "b", "c"]), "Pack item 'essay'"),
    ],
)
def test_nested_documents_use_their_own_validators(edit, message):
    assert message in rejected(changed(edit))


def test_project_selections_must_reference_pack_sub_agents():
    message = rejected(changed(lambda d: d["project"].update(sub_agents=["missing"])))
    assert "does not define" in message
    assert "project sub-agents" in rejected(
        changed(lambda d: d["project"].update(sub_agents=["researcher", "researcher"]))
    )


def test_serialize_refuses_oversized_packs():
    agents = tuple(
        {"key": f"agent-{i}", "name": f"Agent {i}", "instructions": "x" * 100_000} for i in range(MAX_SUB_AGENTS)
    )
    data = {"format": PACK_FORMAT, "format_version": 1, "pack": manifest()["pack"], "sub_agents": agents}
    with pytest.raises(BadDataException):
        serialize_pack(PackManifest.model_validate(data))


def test_published_schema_matches_the_models():
    assert json.loads(SCHEMA_PATH.read_text(encoding="utf-8")) == pack_json_schema()


def test_schema_closes_every_object():
    schema = pack_json_schema()
    objects = [schema, *schema["$defs"].values()]
    assert all(item.get("additionalProperties") is False for item in objects if item.get("type") == "object")


@pytest.mark.parametrize("unit", ["a.", "eyJ-", "x://", "x://a:", "sk-a ", "Bearer ", "-----BEGIN A "])
def test_credential_screen_stays_linear_on_hostile_text(unit):
    text = unit * ((MAX_PACK_BYTES - 4_096) // len(unit))
    started = time.perf_counter()
    rejected(changed(lambda d: d["sub_agents"][0].update(instructions=text)))
    assert time.perf_counter() - started < 5
