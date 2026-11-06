"""Write the team-pack JSON Schema. From apps/backend:
uv run python scripts/export_pack_schema.py
"""

import json
from pathlib import Path

from asterism.domains.packs.documents import pack_json_schema

TARGET = Path(__file__).resolve().parents[3] / "docs" / "schemas" / "team-pack-v1.schema.json"

if __name__ == "__main__":
    TARGET.parent.mkdir(exist_ok=True)
    TARGET.write_text(json.dumps(pack_json_schema(), indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
