import logging


async def suppress_exceptions(coro, logger: logging.Logger):
    try:
        return await coro
    except Exception as e:
        logger.error(e)
