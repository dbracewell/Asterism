"""ComfyUI workflow templates: the built-in workflow, checks and placeholder filling (US-76.3).

Workflows are ComfyUI's API format: node id → ``{"class_type", "inputs"}``.
A string that is exactly ``{{name}}`` becomes the typed value (a number for
``{{width}}``); placeholders inside longer strings are replaced as text.
User text only ever lands in string values, never in the workflow structure.
"""

import copy
import re
from typing import Any

PLACEHOLDERS = ("prompt", "negative_prompt", "width", "height", "seed", "steps", "guidance", "checkpoint")
_PATTERN = re.compile(r"\{\{\s*([A-Za-z_]+)\s*\}\}")

DEFAULT_WORKFLOW: dict[str, Any] = {
    "4": {"class_type": "CheckpointLoaderSimple", "inputs": {"ckpt_name": "{{checkpoint}}"}},
    "5": {"class_type": "EmptyLatentImage", "inputs": {"width": "{{width}}", "height": "{{height}}", "batch_size": 1}},
    "6": {"class_type": "CLIPTextEncode", "inputs": {"text": "{{prompt}}", "clip": ["4", 1]}},
    "7": {"class_type": "CLIPTextEncode", "inputs": {"text": "{{negative_prompt}}", "clip": ["4", 1]}},
    "3": {
        "class_type": "KSampler",
        "inputs": {
            "seed": "{{seed}}",
            "steps": "{{steps}}",
            "cfg": "{{guidance}}",
            "sampler_name": "euler",
            "scheduler": "normal",
            "denoise": 1.0,
            "model": ["4", 0],
            "positive": ["6", 0],
            "negative": ["7", 0],
            "latent_image": ["5", 0],
        },
    },
    "8": {"class_type": "VAEDecode", "inputs": {"samples": ["3", 0], "vae": ["4", 2]}},
    "9": {"class_type": "SaveImage", "inputs": {"filename_prefix": "asterism", "images": ["8", 0]}},
}


def _strings(value: Any):
    if isinstance(value, str):
        yield value
    elif isinstance(value, dict):
        for item in value.values():
            yield from _strings(item)
    elif isinstance(value, list):
        for item in value:
            yield from _strings(item)


def placeholders_in(workflow: dict[str, Any]) -> set[str]:
    return {match for text in _strings(workflow) for match in _PATTERN.findall(text)}


def check_workflow(workflow: dict[str, Any]) -> None:
    """Raise ValueError with an admin-readable reason when the workflow can't be used."""
    if "nodes" in workflow and "links" in workflow:
        raise ValueError("This is ComfyUI's UI format. Export the workflow with Save (API) instead.")
    if not workflow:
        raise ValueError("The workflow is empty")
    for node_id, node in workflow.items():
        if not isinstance(node, dict) or not isinstance(node.get("class_type"), str):
            raise ValueError(f"Node {node_id} has no class_type; is this an API-format workflow?")
        if not isinstance(node.get("inputs", {}), dict):
            raise ValueError(f"Node {node_id} has malformed inputs")
    used = placeholders_in(workflow)
    if unknown := used - set(PLACEHOLDERS):
        raise ValueError(f"Unknown placeholders: {', '.join('{{' + name + '}}' for name in sorted(unknown))}")
    if "prompt" not in used:
        raise ValueError("The workflow needs a {{prompt}} placeholder")


def fill(workflow: dict[str, Any], values: dict[str, Any]) -> dict[str, Any]:
    def visit(value: Any) -> Any:
        if isinstance(value, str):
            whole = _PATTERN.fullmatch(value.strip())
            if whole:
                return values[whole.group(1)]
            return _PATTERN.sub(lambda match: str(values[match.group(1)]), value)
        if isinstance(value, dict):
            return {key: visit(item) for key, item in value.items()}
        if isinstance(value, list):
            return [visit(item) for item in value]
        return value

    return visit(copy.deepcopy(workflow))
