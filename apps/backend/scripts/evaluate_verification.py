"""Run the verify-pass fixtures against a live OpenAI-compatible model.

This measures prompt quality and does not gate CI. From apps/backend:
    node ../../scripts/run-with-env.mjs --env none --scope backend --profile test -- \
      uv run python scripts/evaluate_verification.py \
      --base-url http://localhost:11434/v1 --model llama3.1 [--api-key-env OPENAI_API_KEY]
"""

import argparse
import asyncio
import json
import os

import httpx
from asterism.domains.chat.verification_eval import (
    CaseResult,
    extraction_prompt,
    judgment_prompt,
    load_suite,
    score_extraction,
    score_judgment,
)


async def reply(client: httpx.AsyncClient, *, model: str, messages: list[dict[str, str]]) -> str:
    response = await client.post("/chat/completions", json={"model": model, "messages": messages})
    response.raise_for_status()
    return response.json()["choices"][0]["message"]["content"] or ""


async def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--base-url", required=True)
    parser.add_argument("--model", required=True)
    parser.add_argument("--api-key-env", help="Environment variable holding the API key")
    args = parser.parse_args()
    key = os.environ.get(args.api_key_env, "") if args.api_key_env else ""
    headers = {"Authorization": f"Bearer {key}"} if key else {}
    suite = load_suite()
    report: dict[str, list[CaseResult]] = {"extraction": [], "judgment": []}
    async with httpx.AsyncClient(base_url=args.base_url, headers=headers, timeout=120) as client:
        for case in suite.extraction:
            try:
                text = await reply(client, model=args.model, messages=extraction_prompt(case))
                report["extraction"].append(score_extraction(case, text))
            except httpx.HTTPError as error:
                report["extraction"].append(CaseResult(id=case.id, passed=False, failures=[str(error)]))
        for case in suite.judgment:
            try:
                text = await reply(client, model=args.model, messages=judgment_prompt(case))
                report["judgment"].append(score_judgment(case, text))
            except httpx.HTTPError as error:
                report["judgment"].append(CaseResult(id=case.id, passed=False, failures=[str(error)]))
    print(
        json.dumps(
            {
                kind: {
                    "passed": sum(result.passed for result in results),
                    "total": len(results),
                    "cases": [result.model_dump() for result in results],
                }
                for kind, results in report.items()
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    asyncio.run(main())
