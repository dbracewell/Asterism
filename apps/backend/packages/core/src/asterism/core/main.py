import json
from contextlib import asynccontextmanager

from fastapi import (
    FastAPI,
    HTTPException,
    Request,
)
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.openapi.utils import get_openapi
from fastapi.responses import JSONResponse

from asterism.core.config import config
from asterism.core.data import db_session_manager
from asterism.core.exceptions import CodedException
from asterism.core.logging import get_logger
from asterism.core.routers import (
    chat_router,
    file_router,
    folder_router,
)
from asterism.core.schemas import ErrorDetail

logger = get_logger("AsterismMain")


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Asterism backend starting up...")
    db_session_manager.init()
    yield
    await db_session_manager.close()
    logger.info("Asterism backend shutting up...")


app = FastAPI(
    lifespan=lifespan,
    title="Asterism",
    root_path="/api/py",
    docs_url="/api/py/docs",
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
                            "schema": {"$ref": "#/components/schemas/ErrorDetail"}
                        }
                    },
                }

    openapi_schema["components"]["schemas"].pop("HTTPValidationError", None)
    openapi_schema["components"]["schemas"].pop("ValidationError", None)

    app.openapi_schema = openapi_schema
    return app.openapi_schema


app.openapi = custom_openapi  # type: ignore

app.add_middleware(
    CORSMiddleware,
    allow_origins=config.CORS_ALLOWED_ORIGINS,
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


@app.exception_handler(CodedException)
async def global_coded_exception_handler(
    request: Request,
    exc: CodedException,
):
    error_data = ErrorDetail(code=exc.code, detail=str(exc))
    return JSONResponse(
        status_code=exc.code,
        content=error_data.model_dump(),
    )


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    error_response = ErrorDetail(
        code=500,
        detail=json.dumps(exc.errors()),
    )
    return JSONResponse(
        status_code=422,
        content=error_response.model_dump(),
    )


app.include_router(file_router)
app.include_router(chat_router)
app.include_router(folder_router)
