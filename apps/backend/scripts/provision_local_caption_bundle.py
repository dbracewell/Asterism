"""Create the integrity manifest for an already-downloaded local SmolVLM2 bundle.

This script never downloads model files. Example from apps/backend:
    uv run python scripts/provision_local_caption_bundle.py \
      --model-root /storage/models/captioning-smolvlm2 \
      --model-id HuggingFaceTB/SmolVLM2-256M-Video-Instruct --revision <reviewed-revision>

Set the printed SHA-256 as LOCAL_CAPTION_MODEL_BUNDLE_SHA256.
"""

import argparse
from pathlib import Path

from asterism.domains.knowledge.caption_download import write_manifest


def arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model-root", type=Path, required=True)
    parser.add_argument("--model-id", required=True)
    parser.add_argument("--revision", required=True)
    return parser.parse_args()


if __name__ == "__main__":
    args = arguments()
    sha256 = write_manifest(args.model_root, model_id=args.model_id, revision=args.revision)
    print(sha256)
