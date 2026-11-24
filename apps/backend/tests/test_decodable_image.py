"""``is_decodable_image``: ingestion's check that an image can be read."""

import io

from asterism.common.images import is_decodable_image
from PIL import Image


def _jpeg() -> bytes:
    buffer = io.BytesIO()
    Image.new("RGB", (64, 64), "teal").save(buffer, format="JPEG")
    return buffer.getvalue()


def test_a_whole_image_is_decodable():
    assert is_decodable_image(_jpeg())


def test_text_or_a_cut_off_image_is_not():
    data = _jpeg()
    assert not is_decodable_image(b"Not a real photo: the upload was cut off.")
    assert not is_decodable_image(data[: len(data) // 2])
