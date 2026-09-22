import hashlib
import json
import uuid
from pathlib import Path

import pytest
from asterism.domains.knowledge.captioning import (
    LOCAL_SMOLVLM2_MODEL_ID,
    LOCAL_SMOLVLM2_REVISION,
    CaptionErrorCode,
    CaptioningConfiguration,
    CaptioningError,
    CaptionMode,
    CaptionRequest,
    LocalSmolVlm2CaptionProvider,
    bounded_caption,
)
from asterism.domains.settings.provider_types import ModelCapabilitySource


class Model:
    def __init__(
        self, *, active: bool, vision: bool | None, source: ModelCapabilitySource = ModelCapabilitySource.PROVIDER
    ) -> None:
        self.id = uuid.uuid4()
        self.is_active = active
        self.supports_vision = vision
        self.vision_source = source


def test_captioning_is_disabled_by_default_and_provider_needs_active_vision_model():
    CaptioningConfiguration().validate([])
    vision = Model(active=True, vision=True)
    CaptioningConfiguration(mode=CaptionMode.PROVIDER, provider_model_id=vision.id).validate([vision])

    for model in (
        Model(active=False, vision=True),
        Model(active=True, vision=False),
        Model(active=True, vision=None),
        Model(active=True, vision=True, source=ModelCapabilitySource.MANUAL),
    ):
        with pytest.raises(CaptioningError, match="vision-capable") as error:
            CaptioningConfiguration(mode=CaptionMode.PROVIDER, provider_model_id=model.id).validate([model])
        assert error.value.code is CaptionErrorCode.INVALID_SELECTION


@pytest.mark.parametrize(
    "configuration",
    [
        CaptioningConfiguration(mode=CaptionMode.PROVIDER),
        CaptioningConfiguration(mode=CaptionMode.LOCAL, provider_model_id=uuid.uuid4()),
        CaptioningConfiguration(mode=CaptionMode.DISABLED, provider_model_id=uuid.uuid4()),
    ],
)
def test_captioning_configuration_rejects_invalid_mode_selection(configuration):
    with pytest.raises(CaptioningError) as error:
        configuration.validate([])
    assert error.value.code is CaptionErrorCode.INVALID_SELECTION


@pytest.mark.asyncio
async def test_local_captioning_never_initializes_without_a_provisioned_manifest(tmp_path: Path):
    provider = LocalSmolVlm2CaptionProvider(tmp_path, bundle_sha256="")
    with pytest.raises(CaptioningError, match="not been provisioned") as error:
        await provider.initialize()
    assert error.value.code is CaptionErrorCode.NOT_READY


@pytest.mark.asyncio
async def test_local_captioning_verifies_manifest_and_all_declared_files_before_loading(tmp_path: Path):
    model_file = tmp_path / "weights.safetensors"
    model_file.write_bytes(b"expected weights")
    manifest = {
        "model_id": LOCAL_SMOLVLM2_MODEL_ID,
        "revision": LOCAL_SMOLVLM2_REVISION,
        "files": {"weights.safetensors": "0" * 64},
    }
    manifest_bytes = json.dumps(manifest).encode()
    (tmp_path / "manifest.json").write_bytes(manifest_bytes)
    provider = LocalSmolVlm2CaptionProvider(tmp_path, bundle_sha256=hashlib.sha256(manifest_bytes).hexdigest())

    with pytest.raises(CaptioningError, match="artifact verification failed") as error:
        await provider.initialize()
    assert error.value.code is CaptionErrorCode.ARTIFACT_INVALID


def test_caption_output_is_normalized_and_bounded():
    assert bounded_caption(" a\n  useful\timage ", 100) == "a useful image"
    assert bounded_caption("123456", 4) == "1234"
    with pytest.raises(CaptioningError) as error:
        bounded_caption(" \n", 4)
    assert error.value.code is CaptionErrorCode.OUTPUT_INVALID


def test_local_caption_request_is_a_path_reference_not_image_bytes(tmp_path: Path):
    request = CaptionRequest(
        revision_id=uuid.uuid4(), image_path=tmp_path / "image.png", max_image_bytes=1, max_caption_chars=1
    )
    assert request.image_path.name == "image.png"
