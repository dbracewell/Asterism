/** Only a leading run of standalone slash names is executable syntax. */
export function parseSkillCommands(source: string) {
  let rest = source.trimStart();
  const names: string[] = [];
  let consumed = source.length - rest.length;
  while (true) {
    const match = /^\/([A-Za-z0-9_-]+)(?=\s|$)/.exec(rest);
    if (!match) break;
    names.push(match[1]);
    const tail = rest.slice(match[0].length);
    const next = tail.trimStart();
    consumed += match[0].length + tail.length - next.length;
    rest = next;
  }
  return {
    names: [...new Set(names)],
    prompt: source.slice(consumed),
    consumed,
  };
}

export function slashSearch(source: string): string | null {
  const parsed = parseSkillCommands(source);
  const tail = parsed.prompt;
  if (/^\/[a-z0-9-]*$/.test(tail)) return tail.slice(1);
  // A complete last command still offers discovery until whitespace is entered.
  const match = /(?:^|\s)\/([a-z0-9-]*)$/.exec(source);
  if (match && parsed.names.length && !parsed.prompt) return match[1];
  return null;
}
