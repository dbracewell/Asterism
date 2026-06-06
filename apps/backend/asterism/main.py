import json
from contextlib import asynccontextmanager

from fastapi import (
    FastAPI,
    HTTPException,
    Query,
    Request,
    WebSocket,
    WebSocketDisconnect,
    WebSocketException,
)
from fastapi.middleware.cors import CORSMiddleware
from fastapi.openapi.utils import get_openapi
from fastapi.responses import JSONResponse, StreamingResponse
from openai import AsyncOpenAI
from pydantic import BaseModel, Field

from asterism.internal.db import DBSessionDep, session_manager
from asterism.logging import get_logger
from asterism.routers import chat_router, file_router
from asterism.routers.typedefs import ErrorDetail
from asterism.utils.security import verify_jwks_token

client = AsyncOpenAI(api_key="1234", base_url="http://localhost:1234/v1")

logger = get_logger("AsterismMain")


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Asterism backend starting up...")
    session_manager.init()
    yield
    if session_manager.is_initialized:
        await session_manager.close()
    logger.info("Asterism backend shutting up...")


app = FastAPI(
    lifespan=lifespan,
    title="Asterism",
    docs_url="/api/docs",
)


def custom_openapi():
    if app.openapi_schema:
        return app.openapi_schema
    openapi_schema = get_openapi(
        title="Asterism",
        version="1.0.0",
        routes=app.routes,
    )
    openapi_schema["openapi"] = "3.0.3"
    app.openapi_schema = openapi_schema
    return app.openapi_schema


app.openapi = custom_openapi  # type: ignore

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(HTTPException)
async def global_http_exception_handler(
    request: Request,
    exc: HTTPException,
):
    error_data = ErrorDetail(code=exc.status_code, detail=str(exc.detail))
    return JSONResponse(
        status_code=exc.status_code,
        content=error_data.model_dump(),
    )


app.include_router(file_router)
app.include_router(chat_router)


async def data_generator(messages: list, db: DBSessionDep):
    response = await client.chat.completions.create(
        stream=True,
        model="qwen/qwen3-4b-2507",
        messages=messages,
    )
    last_message = None
    async for chunk in response:
        last_message = chunk.to_dict()
        yield json.dumps(last_message) + "\n\n"


class StreamRequest(BaseModel):
    content: str = Field(..., description="The prompt content to stream")


class StreamChunk(BaseModel):
    role: str
    content: str


@app.post(
    "/api/stream",
    response_class=StreamingResponse,
    operation_id="streamChat",
    responses={
        200: {
            "description": "Stream of NDJSON chunks",
            "content": {
                "application/x-ndjson": {
                    "schema": {
                        "schema": {
                            "anyOf": [
                                {"type": "string", "format": "binary"},
                                StreamChunk.model_json_schema(),
                            ]
                        }
                    }
                }
            },
        },
        401: {"model": ErrorDetail},
    },
)
async def async_test(body: StreamRequest, db: DBSessionDep):
    return StreamingResponse(
        data_generator([{"role": "user", "content": body.content}], db),
        media_type="application/x-ndjson",
    )


@app.websocket("/ws/chat/{chat_id}")
async def chat(websocket: WebSocket, chat_id: str, token: str = Query(...)):
    try:
        verify_jwks_token(token)
    except WebSocketException as e:
        await websocket.close(code=e.code, reason=e.reason)
        return

    await websocket.accept()
    try:
        while True:
            raw_data = await websocket.receive_text()
            message_data = json.loads(raw_data)
            user_prompt = message_data.get("message", "")

            await websocket.send_text(json.dumps({"type": "stream_start"}))
            response = await client.chat.completions.create(
                stream=True,
                model="qwen/qwen3-4b-2507",
                messages=[{"role": "user", "content": user_prompt}],
            )
            final_response = ""
            async for chunk in response:
                if not chunk.choices:
                    continue

                choice = chunk.choices[0]
                delta = choice.delta
                if delta.content:
                    final_response += delta.content
                    await websocket.send_text(
                        json.dumps(
                            {
                                "role": "assistant",
                                "type": "text_delta",
                                "content": delta.content,
                            }
                        )
                    )

            await websocket.send_text(
                json.dumps({"type": "stream_end", "content": final_response})
            )

    except WebSocketDisconnect:
        print("Chat stream disconnected for session")
    except Exception as e:
        await websocket.send_text(json.dumps({"type": "error", "message": str(e)}))
