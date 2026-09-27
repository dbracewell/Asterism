export function prettyText(text: string) {
  return text
    .split(/[_-]+/)
    .map((word) => word[0].toLocaleUpperCase() + word.slice(1))
    .join(" ");
}

export function formatPlural(count: number, singular: string, plural?: string) {
  if (count === 1) {
    return `${count} ${singular}`;
  } else {
    return `${count} ${plural ?? singular + "s"}`;
  }
}

export function formatFileSize(
  bytes: number,
  decimalPlaces = 2,
  useBinary = true,
): string {
  if (bytes === 0) return "0 Bytes";

  const base = useBinary ? 1024 : 1000;
  const units = useBinary
    ? ["Bytes", "KiB", "MiB", "GiB", "TiB", "PiB"]
    : ["Bytes", "KB", "MB", "GB", "TB", "PB"];

  const exponent = Math.floor(Math.log(bytes) / Math.log(base));
  const size = bytes / Math.pow(base, exponent);

  if (exponent === 0) {
    return `${size.toFixed(0)} ${units[exponent]}`;
  }
  return `${size.toFixed(decimalPlaces)} ${units[exponent]}`;
}
