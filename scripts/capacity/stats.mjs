// Small statistics helpers for the capacity check (US-86.7).

/** Nearest-rank percentile of `values` (0 < p <= 100); null when empty. */
export function percentile(values, p) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length, Math.max(1, rank)) - 1];
}

/** Count, p50, p95 and max of a list of durations. */
export function summarize(values) {
  return {
    count: values.length,
    p50: percentile(values, 50),
    p95: percentile(values, 95),
    max: values.length ? Math.max(...values) : null,
  };
}

/** Parse a Docker size such as "1.25GiB" or "512MiB" into bytes. */
export function parseDockerSize(text) {
  const match = /^([\d.]+)\s*([KMGT]?i?B)$/i.exec(text.trim());
  if (!match) return null;
  const units = { B: 1, KB: 1e3, MB: 1e6, GB: 1e9, TB: 1e12, KIB: 1024, MIB: 1024 ** 2, GIB: 1024 ** 3, TIB: 1024 ** 4 };
  const unit = units[match[2].toUpperCase()];
  return unit ? Math.round(Number(match[1]) * unit) : null;
}

export const seconds = (ms) => (ms == null ? "–" : `${(ms / 1000).toFixed(2)} s`);
export const gib = (bytes) => (bytes == null ? "–" : `${(bytes / 1024 ** 3).toFixed(2)} GiB`);
