"""Run the learning-mode fixtures against a live OpenAI-compatible model.

This measures prompt compliance and does not gate CI. From apps/backend:
    node ../../scripts/run-with-env.mjs --env none --scope backend --profile test -- \
      uv run python scripts/evaluate_learning_modes.py \
      --base-url http://localhost:11434/v1 --model llama3.1 [--api-key-env OPENAI_API_KEY]
"""

import argparse
import asyncio
import json
import os

import httpx
from asterism.domains.learning.evaluation import CaseResult, EvalCase, EvalSuite, load_suites, score


async def reply(client: httpx.AsyncClient, *, model: str, system: str, case: EvalCase) -> str:
    response = await client.post(
        "/chat/completions",
        json={
            "model": model,
            "messages": [{"role": "system", "content": system}, *[item.model_dump() for item in case.messages]],
        },
    )
    response.raise_for_status()
    return response.json()["choices"][0]["message"]["content"] or ""


async def run_suite(client: httpx.AsyncClient, *, model: str, suite: EvalSuite) -> list[CaseResult]:
    results = []
    for case in suite.cases:
        try:
            text = await reply(client, model=model, system=suite.system_prompts[case.hint_level], case=case)
            results.append(score(case, text))
        except httpx.HTTPError as error:
            results.append(CaseResult(id=case.id, passed=False, failures=[f"request failed: {error}"]))
    return results


async def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--base-url", required=True)
    parser.add_argument("--model", required=True)
    parser.add_argument("--api-key-env", help="Environment variable holding the API key")
    parser.add_argument("--mode", help="Run only this mode's suite")
    args = parser.parse_args()
    key = os.environ.get(args.api_key_env, "") if args.api_key_env else ""
    headers = {"Authorization": f"Bearer {key}"} if key else {}
    report = {}
    async with httpx.AsyncClient(base_url=args.base_url, headers=headers, timeout=120) as client:
        for suite in load_suites():
            if args.mode and suite.mode.value != args.mode:
                continue
            results = await run_suite(client, model=args.model, suite=suite)
            report[suite.mode.value] = {
                "passed": sum(result.passed for result in results),
                "total": len(results),
                "cases": [result.model_dump() for result in results],
            }
    print(json.dumps({"model": args.model, "suites": report}, indent=2))


if __name__ == "__main__":
    asyncio.run(main())
