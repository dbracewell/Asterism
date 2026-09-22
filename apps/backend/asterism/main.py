import json

import truststore
from fastapi import (
    FastAPI,
    HTTPException,
    Request,
)
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.openapi.utils import get_openapi
from fastapi.responses import JSONResponse

from asterism.common.log import get_logger
from asterism.core import config
from asterism.core.exceptions import CodedException
from asterism.core.lifespan import lifespan
from asterism.core.schemas import ErrorDetail
from asterism.domains.agent.router import agents_router
from asterism.domains.chat.router import chat_router
from asterism.domains.components.router import components_router
from asterism.domains.files.router import file_router
from asterism.domains.folders.router import folder_router
from asterism.domains.knowledge.router import knowledge_router
from asterism.domains.settings.settings_router import settings_router
from asterism.domains.tools.router import tools_router
from asterism.domains.user.router import user_router

truststore.inject_into_ssl()
logger = get_logger("Asterism")


app = FastAPI(
    lifespan=lifespan,
    title="Asterism",
    root_path="/api/py",
    docs_url="/api/py/docs",
)


def openapi_schema():
    if app.openapi_schema:
        return app.openapi_schema

    openapi_schema = get_openapi(
        title="Asterism",
        version="1.0.0",
        routes=app.routes,
    )

    if "ErrorDetail" not in openapi_schema["components"]["schemas"]:
        openapi_schema["components"]["schemas"]["ErrorDetail"] = (
            ErrorDetail.model_json_schema()
        )

    for path, methods in openapi_schema["paths"].items():
        for method, operation in methods.items():
            if "responses" in operation and "422" in operation["responses"]:
                operation["responses"]["422"] = {
                    "description": "Validation Error",
                    "content": {
                        "application/json": {
                            "schema": {
                                "$ref": "#/components/schemas/ErrorDetail",
                            }
                        }
                    },
                }

    openapi_schema["components"]["schemas"].pop("HTTPValidationError", None)
    openapi_schema["components"]["schemas"].pop("ValidationError", None)

    app.openapi_schema = openapi_schema
    return app.openapi_schema


app.openapi = openapi_schema  # type:ignore

app.add_middleware(
    CORSMiddleware,
    allow_origins=config.cors_allowed_origins or ["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(HTTPException)
async def global_http_exception_handler(
    _: Request,
    exc: HTTPException,
):
    error_data = ErrorDetail(code=exc.status_code, detail=str(exc.detail))
    return JSONResponse(
        status_code=exc.status_code,
        content=error_data.model_dump(),
    )


@app.exception_handler(CodedException)
async def global_coded_exception_handler(
    _: Request,
    exc: CodedException,
):
    error_data = ErrorDetail(code=exc.code, detail=str(exc))
    return JSONResponse(
        status_code=exc.code,
        content=error_data.model_dump(),
    )


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(
    _: Request,
    exc: RequestValidationError,
):
    error_message = []
    for error in exc.errors():
        error_message.append(f"{error['msg']}: {error['input']}")
    error_response = ErrorDetail(
        code=422,
        detail=json.dumps("\n".join(error_message)),
    )
    return JSONResponse(
        status_code=422,
        content=error_response.model_dump(),
    )


app.include_router(file_router)
app.include_router(chat_router)
app.include_router(folder_router)
app.include_router(knowledge_router)
app.include_router(settings_router)
app.include_router(user_router)
app.include_router(tools_router)
app.include_router(components_router)
app.include_router(agents_router)
