import copy


def inline_refs(schema: dict) -> dict:
    """Recursively inline all $ref pointers and remove $defs."""
    schema = copy.deepcopy(schema)
    defs = schema.pop("$defs", {})

    def resolve(node):
        if isinstance(node, dict):
            if "$ref" in node:
                ref_name = node["$ref"].split("/")[-1]
                resolved_def = resolve(defs[ref_name])
                merged = {**resolved_def}
                for k, v in node.items():
                    if k != "$ref":
                        merged[k] = resolve(v)
                return merged
            return {k: resolve(v) for k, v in node.items()}
        elif isinstance(node, list):
            return [resolve(item) for item in node]
        return node

    return resolve(schema)
