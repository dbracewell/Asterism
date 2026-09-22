import json

from asterism.domains.llm.schemas import Function, ToolCall
from asterism.domains.tools.registry import ToolRegistry
from sqlalchemy.exc import StatementError


def test_tool_failures_are_json_serializable_for_message_persistence():
    tool_call = ToolCall(id="call-1", function=Function(name="search_knowledge", arguments="{}"))
    result = ToolRegistry._exception_to_tool_result(
        StatementError("statement", "SELECT 1", {}, ValueError("bad UUID")), tool_call
    )

    assert json.loads(result.content)["error"].startswith("Tool failed with exception:")
    assert result.raw_result == json.loads(result.content)
    # This mirrors serialization into the messages JSON column.
    assert json.dumps(result.to_dict())
