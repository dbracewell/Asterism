"""Supported backend launcher: exactly one Uvicorn worker per application."""

import argparse
import os
from collections.abc import Mapping, Sequence

import uvicorn


def validate_workers(environment: Mapping[str, str]) -> None:
    """Reject server environment overrides that imply unsupported worker modes."""
    for name in ("WEB_CONCURRENCY", "UVICORN_WORKERS"):
        if name in environment and environment[name] != "1":
            raise ValueError(f"{name} must be unset or 1; multiple backend workers are unsupported")


def main(arguments: Sequence[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--workers", "-w", type=int, choices=(1,), default=1)
    parser.add_argument("--timeout-graceful-shutdown", type=int)
    parser.add_argument("--proxy-headers", action=argparse.BooleanOptionalAction, default=True)
    parser.add_argument("--forwarded-allow-ips", default=os.environ.get("FORWARDED_ALLOW_IPS", "127.0.0.1"))
    parser.add_argument(
        "--check", action="store_true", help="Validate worker settings without importing the application"
    )
    options = parser.parse_args(arguments)
    try:
        validate_workers(os.environ)
    except ValueError as error:
        parser.error(str(error))
    if options.check:
        print("Backend launch configuration: one worker")
        return
    uvicorn.run(
        "asterism.main:app",
        host=options.host,
        port=options.port,
        workers=1,
        timeout_graceful_shutdown=options.timeout_graceful_shutdown,
        proxy_headers=options.proxy_headers,
        forwarded_allow_ips=options.forwarded_allow_ips,
    )


if __name__ == "__main__":
    main()
