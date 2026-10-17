import logging

import pytest
from asterism.common.log import RedactTransportTokens
from uvicorn.logging import AccessFormatter


@pytest.mark.parametrize("name", ["uvicorn.error", "uvicorn.access"])
def test_transport_loggers_install_query_credential_redaction(name):
    assert any(isinstance(item, RedactTransportTokens) for item in logging.getLogger(name).filters)


def test_websocket_acceptance_log_redacts_tokens_and_preserves_routing_context():
    record = logging.LogRecord(
        "uvicorn.error",
        logging.INFO,
        __file__,
        0,
        '%s - "WebSocket %s" [accepted]',
        ("client", "/api/py/chat/stream/chat-id?token=synthetic-secret&branch=1&access_token=other-secret"),
        None,
    )
    RedactTransportTokens().filter(record)
    message = record.getMessage()
    assert "synthetic-secret" not in message
    assert "other-secret" not in message
    assert "chat-id?token=[redacted]&branch=1&access_token=[redacted]" in message
    assert "[accepted]" in message


def test_access_formatter_still_accepts_filtered_record_tuple():
    record = logging.LogRecord(
        "uvicorn.access",
        logging.INFO,
        __file__,
        0,
        '%s - "%s %s HTTP/%s" %d',
        ("client", "GET", "/route?token=synthetic-secret", "1.1", 200),
        None,
    )
    RedactTransportTokens().filter(record)
    message = AccessFormatter("%(request_line)s %(status_code)s", use_colors=False).format(record)
    assert "synthetic-secret" not in message
    assert "/route?token=[redacted]" in message
    assert "200" in message
