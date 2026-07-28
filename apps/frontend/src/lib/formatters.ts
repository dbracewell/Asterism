export function prettyText(text: string) {
  return text
    .split("_")
    .map((word) => word[0].toLocaleUpperCase() + word.slice(1))
    .join(" ");
}
