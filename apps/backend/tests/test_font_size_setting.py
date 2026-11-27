"""US-116.2: the font-size setting accepts only the sizes Settings offers."""

import pytest
from asterism.core.exceptions import BadDataException
from asterism.domains.settings.service import FONT_SIZES, _validate_user_setting


@pytest.mark.asyncio
@pytest.mark.parametrize("size", FONT_SIZES)
async def test_offered_sizes_are_accepted(size):
    await _validate_user_setting("user", "font_size", size, None)  # pyright: ignore[reportArgumentType]


@pytest.mark.asyncio
@pytest.mark.parametrize("size", ["15px", "100px", "1rem", "16px; color: red", "calc(100vw)", ""])
async def test_other_values_are_refused(size):
    with pytest.raises(BadDataException, match="font_size must be one of"):
        await _validate_user_setting("user", "font_size", size, None)  # pyright: ignore[reportArgumentType]
