from datetime import datetime

from asterism.core.llm.tool_registory import tool_registry


@tool_registry.tool(name="get_current_date", description="Get current date")
def current_date() -> str:
    print("Calling: current_date")
    return datetime.now().strftime("%Y-%m-%d")
