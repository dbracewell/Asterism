"""Helpers for normalizing JSON Schema documents."""

import copy


def inline_refs(schema: dict) -> dict:
    """Recursively inline all $ref pointers and remove $defs.

    Args:
        schema: A JSON Schema dict that may reference local definitions via ``$ref``
            (e.g., ``#/$defs/Foo``). The input is not mutated.

    Returns:
        A new schema with every referenced definition merged in place of the pointer
        and the top-level $defs removed, so consumers that do not understand $ref
        can use it directly. Sibling keys on a referencing node are preserved and
        take precedence over the referenced definition's keys.
    """
    schema = copy.deepcopy(schema)
    defs = schema.pop("$defs", {})

    def resolve(node):
        # Walk the schema tree, substituting $ref pointers with their (recursively resolved) definitions.
        if isinstance(node, dict):
            if "$ref" in node:
                ref_name = node["$ref"].split("/")[-1]
                resolved_def = resolve(defs[ref_name])
                merged = {**resolved_def}  # type: ignore
                for k, v in node.items():
                    if k != "$ref":
                        merged[k] = resolve(v)
                return merged
            return {k: resolve(v) for k, v in node.items()}
        elif isinstance(node, list):
            return [resolve(item) for item in node]
        return node

    return resolve(schema)  # type: ignore
