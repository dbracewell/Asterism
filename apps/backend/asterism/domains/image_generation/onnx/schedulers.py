"""The diffusion schedulers the ONNX pipelines use, in NumPy (ADR-0077, US-94.4).

Ports of the parts of diffusers' ``LCMScheduler`` and
``EulerAncestralDiscreteScheduler`` (``timestep_spacing="trailing"``) that the
catalog models need, so image generation runs without PyTorch.
"""

import numpy as np


def scaled_linear_alphas_cumprod(beta_start: float, beta_end: float, train_steps: int) -> np.ndarray:
    """Cumulative alpha products for Stable Diffusion's "scaled_linear" beta schedule."""
    betas = np.linspace(beta_start**0.5, beta_end**0.5, train_steps, dtype=np.float64) ** 2
    return np.cumprod(1.0 - betas)


# --- Latent Consistency Models -------------------------------------------------


def lcm_timesteps(steps: int, train_steps: int = 1000, original_steps: int = 50) -> np.ndarray:
    """LCM's timesteps: evenly spaced over the distillation schedule, largest first."""
    if not 1 <= steps <= original_steps:
        raise ValueError(f"LCM takes 1 to {original_steps} steps")
    k = train_steps // original_steps
    origin = np.arange(1, original_steps + 1) * k - 1
    indices = np.floor(np.linspace(0, len(origin), num=steps, endpoint=False)).astype(np.int64)
    return origin[::-1][indices]


def guidance_embedding(scale: float, dim: int = 256) -> np.ndarray:
    """The sinusoidal embedding of ``scale - 1`` that a guidance-distilled LCM UNet takes as ``timestep_cond``."""
    w = np.asarray([(scale - 1.0) * 1000.0])
    half = dim // 2
    frequencies = np.exp(np.arange(half) * -(np.log(10000.0) / (half - 1)))
    angles = w[:, None] * frequencies[None, :]
    return np.concatenate([np.sin(angles), np.cos(angles)], axis=1).astype(np.float32)


def lcm_step(
    latents: np.ndarray,
    noise_prediction: np.ndarray,
    timestep: int,
    next_timestep: int | None,
    alphas_cumprod: np.ndarray,
    noise: np.ndarray | None,
) -> np.ndarray:
    """One LCM step: the consistency-model estimate, re-noised to ``next_timestep`` unless it is the last.

    Args:
        latents: The current latents.
        noise_prediction: The UNet's noise prediction for them.
        timestep: The current timestep.
        next_timestep: The next timestep, or ``None`` on the last step.
        alphas_cumprod: The schedule from ``scaled_linear_alphas_cumprod``.
        noise: Fresh Gaussian noise shaped like the latents; required unless last.

    Returns:
        The latents for the next step, or the denoised latents on the last.
    """
    alpha = alphas_cumprod[timestep]
    predicted_original = (latents - np.sqrt(1.0 - alpha) * noise_prediction) / np.sqrt(alpha)
    scaled = timestep * 10.0
    c_skip = 0.25 / (scaled**2 + 0.25)
    c_out = scaled / np.sqrt(scaled**2 + 0.25)
    denoised = c_out * predicted_original + c_skip * latents
    if next_timestep is None:
        return denoised
    if noise is None:
        raise ValueError("A step before the last needs noise")
    next_alpha = alphas_cumprod[next_timestep]
    return np.sqrt(next_alpha) * denoised + np.sqrt(1.0 - next_alpha) * noise


# --- Euler ancestral, trailing spacing (SDXL Turbo) ---------------------------


def trailing_timesteps(steps: int, train_steps: int = 1000) -> np.ndarray:
    """Timesteps spaced back from the last training step, as SDXL Turbo expects: one step is ``[999]``."""
    if not 1 <= steps <= train_steps:
        raise ValueError(f"Takes 1 to {train_steps} steps")
    return np.round(np.arange(train_steps, 0, -train_steps / steps)).astype(np.int64) - 1


def euler_sigmas(timesteps: np.ndarray, alphas_cumprod: np.ndarray) -> np.ndarray:
    """Noise levels at each timestep, then a final 0."""
    all_sigmas = np.sqrt((1.0 - alphas_cumprod) / alphas_cumprod)
    sigmas = np.interp(timesteps.astype(np.float64), np.arange(len(all_sigmas)), all_sigmas)
    return np.concatenate([sigmas, [0.0]])


def euler_ancestral_step(
    latents: np.ndarray,
    noise_prediction: np.ndarray,
    sigma: float,
    next_sigma: float,
    noise: np.ndarray | None,
) -> np.ndarray:
    """One Euler ancestral step from ``sigma`` to ``next_sigma`` (epsilon prediction)."""
    predicted_original = latents - sigma * noise_prediction
    sigma_up = np.sqrt(next_sigma**2 * (sigma**2 - next_sigma**2) / sigma**2)
    sigma_down = np.sqrt(next_sigma**2 - sigma_up**2)
    stepped = latents + (latents - predicted_original) / sigma * (sigma_down - sigma)
    if next_sigma > 0:
        if noise is None:
            raise ValueError("A step before the last needs noise")
        stepped = stepped + noise * sigma_up
    return stepped
