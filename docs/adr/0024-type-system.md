# ADR 0024: Type system

Status: accepted (US-41.1)

## Decision

Asterism loads exactly two font families through `next/font/google`:

- **Schibsted Grotesk** (`--font-ui`) for all UI text and headings.
- **JetBrains Mono** (`--font-code`) for code only.

Inter, Geist, Geist Mono and Montserrat are removed.

## Comparison

Schibsted Grotesk, Hanken Grotesk and Instrument Sans were rendered side by side
with Playwright on chat, settings and list content (Atlas light palette).

- Hanken Grotesk: neutral and readable, but close to the generic sans it replaces.
- Instrument Sans: clean and compact; numerals and punctuation are slightly narrow.
- Schibsted Grotesk: most characterful (distinct `g`, `a` and `t`), still legible
  at 12–14px in dense rows. Chosen.

## Scale

Defined in `globals.css` as Tailwind theme tokens (rem-based, so the user font-size
preference still scales everything):

| Utility        | Size     | Line height | Use                         |
| -------------- | -------- | ----------- | --------------------------- |
| `text-display` | 2.25rem  | 1.1         | Welcome heading             |
| `text-title`   | 1.5rem   | 1.2         | Page titles                 |
| `text-heading` | 1.125rem | 1.35        | Section headings, wordmark  |
| `text-body`    | 0.875rem | 1.5         | Default text                |
| `text-meta`    | 0.75rem  | 1.4         | Timestamps, captions, hints |

`display`, `title` and `heading` set weight 600 and tight tracking. `--font-heading`
resolves to the UI family. The wordmark is sentence case ("Asterism").
