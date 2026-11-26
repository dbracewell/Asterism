"""Ask a live model for diagrams and check that they draw (EPIC-108, US-108.2).

Each fixed prompt in `asterism.domains.chat.diagram_evaluation` is sent under
the main agent's runtime prompt (with its diagram guidance). Every mermaid
block in the answer is drawn with the export renderer, which uses the app's
source preparation, locked configuration and sanitizer, so "drew" here means
it draws in the app. The run measures the guidance and never gates CI.

Needs the frontend's packages (mermaid, DOMPurify) and Playwright's Chromium.
From apps/backend:
    node ../../scripts/run-with-env.mjs --env none --scope backend --profile test -- \
      uv run python scripts/evaluate_diagrams.py \
      --base-url http://localhost:11434/v1 --model llama3.1 \
      [--api-key-env OPENAI_API_KEY] [--repeat 3] [--prompt mind-map] [--json report.json]
"""

import argparse
import asyncio
import json
import os
import re
import uuid
from dataclasses import asdict
from types import SimpleNamespace

import httpx
from asterism.common.headless_browser import close_browser
from asterism.domains.canvas.diagrams import draw_diagrams
from asterism.domains.canvas.exports import mermaid_sources
from asterism.domains.chat.diagram_evaluation import PROMPTS, AnswerResult, DiagramPrompt, score
from asterism.domains.chat.prompt_composition import build_runtime_prompt

# Some local models wrap their reasoning in <think> tags before the answer.
_THINKING = re.compile(r"<think>.*?</think>", re.DOTALL)


async def system_prompt() -> str:
    """The main agent's runtime layer in an ordinary chat with no tools."""
    return await build_runtime_prompt(
        user_id="evaluation",
        chat_id=uuid.uuid4(),
        profile=SimpleNamespace(id=uuid.uuid4(), sub_agent=False),
        tools=[],
        scope=None,
    )


async def ask(client: httpx.AsyncClient, *, model: str, system: str, prompt: DiagramPrompt) -> str:
    response = await client.post(
        "/chat/completions",
        json={
            "model": model,
            "messages": [{"role": "system", "content": system}, {"role": "user", "content": prompt.prompt}],
        },
    )
    response.raise_for_status()
    return _THINKING.sub("", response.json()["choices"][0]["message"]["content"] or "").strip()


async def evaluate(
    client: httpx.AsyncClient, *, model: str, system: str, prompt: DiagramPrompt, answers: list[dict]
) -> AnswerResult:
    try:
        answer = await ask(client, model=model, system=system, prompt=prompt)
    except httpx.HTTPError as error:
        return AnswerResult(prompt=prompt.id, wants_diagram=prompt.wants_diagram, error=f"request failed: {error}")
    sources = mermaid_sources(answer)
    drawn = await draw_diagrams(sources, deadline_seconds=60) if sources else []
    answers.append({"prompt": prompt.id, "answer": answer})
    return score(prompt, answer, drawn)


def summary(results: list[AnswerResult]) -> dict[str, object]:
    diagrams = sum(result.diagrams for result in results)
    return {
        "passed": sum(result.passed for result in results),
        "answers": len(results),
        "diagrams": diagrams,
        "drawn": sum(result.drawn for result in results),
        "named": sum(result.named for result in results),
        "accessibility_first": sum(result.accessibility_first for result in results),
    }


def table(results: list[AnswerResult]) -> str:
    rows = ["prompt      pass  diagrams  drawn  named  acc-first  types                 words"]
    for result in results:
        rows.append(
            f"{result.prompt:<11} {'yes' if result.passed else 'NO':<5} {result.diagrams:<9} {result.drawn:<6} "
            f"{result.named:<6} {result.accessibility_first:<10} {','.join(result.types) or '-':<21} "
            f"{result.words}{'  ' + result.error if result.error else ''}"
        )
    return "\n".join(rows)


async def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--base-url", required=True)
    parser.add_argument("--model", required=True)
    parser.add_argument("--api-key-env", help="Environment variable holding the API key")
    parser.add_argument("--repeat", type=int, default=1, help="Ask each prompt this many times (answers vary)")
    parser.add_argument("--prompt", action="append", help="Run only this prompt id (repeatable)")
    parser.add_argument("--json", help="Also write the results and answers to this file")
    args = parser.parse_args()
    prompts = [prompt for prompt in PROMPTS if not args.prompt or prompt.id in args.prompt]
    key = os.environ.get(args.api_key_env, "") if args.api_key_env else ""
    headers = {"Authorization": f"Bearer {key}"} if key else {}
    system = await system_prompt()
    results: list[AnswerResult] = []
    answers: list[dict] = []
    try:
        async with httpx.AsyncClient(base_url=args.base_url, headers=headers, timeout=300) as client:
            for _ in range(max(1, args.repeat)):
                for prompt in prompts:
                    results.append(
                        await evaluate(client, model=args.model, system=system, prompt=prompt, answers=answers)
                    )
    finally:
        await close_browser()
    print(table(results))
    print(json.dumps(summary(results)))
    if args.json:
        with open(args.json, "w", encoding="utf-8") as file:
            json.dump(
                {
                    "model": args.model,
                    "summary": summary(results),
                    "results": [asdict(result) | {"passed": result.passed} for result in results],
                    "answers": answers,
                },
                file,
                indent=2,
            )


if __name__ == "__main__":
    asyncio.run(main())
