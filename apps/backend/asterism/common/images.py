import base64
import io

from PIL import Image, ImageOps, UnidentifiedImageError


def generate_thumbnail(content: bytes) -> str | None:
    try:
        with Image.open(io.BytesIO(content)) as img:
            img = ImageOps.exif_transpose(img)
            img = img.convert("RGB")
            orig_w, orig_h = img.size
            target_w = 128
            target_h = 128
            if orig_w > orig_h:
                target_h = max(1, int(orig_h * (target_w / orig_w)))
            else:
                target_w = max(1, int(orig_w * (target_h / orig_h)))
            thumbnail_img = img.resize((target_w, target_h), Image.Resampling.LANCZOS)
            buffered = io.BytesIO()
            thumbnail_img.save(buffered, format="jpeg")
            encoded_img = base64.b64encode(buffered.getvalue()).decode("utf-8")
            return f"data:image/jpeg;base64,{encoded_img}"
    except (UnidentifiedImageError, OSError):
        return None
