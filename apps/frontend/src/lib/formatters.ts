export function prettyText(text: string) {
  return text
    .split(/[_-]+/)
    .map((word) => word[0].toLocaleUpperCase() + word.slice(1))
    .join(" ");
}

export function formatPluarl(count: number, singular: string, plural?: string) {
  if (count === 1) {
    return `${count} ${singular}`;
  } else {
    return `${count} ${plural ?? singular + "s"}`;
  }
}
