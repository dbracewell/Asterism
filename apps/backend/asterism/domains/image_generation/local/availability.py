"""Whether this install includes local image generation (ADR-0077, US-94.2).

Diffusers, accelerate, torch and torchvision are the optional ``local-image``
extra: the GPU image build and ``uv sync --extra local-image`` install it, and
the published CPU image doesn't. Without it, the Diffusers generator isn't
registered, a saved one reads as not available, and its catalog and downloads
are hidden. Nothing switches to another generator.
"""

import functools
import importlib.util

LOCAL_IMAGE_PACKAGES = ("diffusers", "accelerate", "torch", "torchvision")
NOT_AVAILABLE = "Local image generation is not available in this image"


@functools.cache
def local_image_installed() -> bool:
    """True when every package of the ``local-image`` extra can be imported.

    Checked by finding the packages, not importing them: importing torch takes
    seconds and hundreds of MB, and this runs at startup.
    """
    return all(importlib.util.find_spec(name) is not None for name in LOCAL_IMAGE_PACKAGES)
