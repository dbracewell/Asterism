// Synthetic data used only by renderer regressions and the test-profile harness.
export const adversarialMarkdown = String.raw`
<div id="untrusted-overlay" style="position:fixed;inset:0;z-index:2147483647" class="fixed">Overlay</div>

<style>body { display: none !important; }</style>
<link rel="stylesheet" href="/untrusted-markdown/evil.css">
<base href="https://untrusted.invalid/">
<meta http-equiv="refresh" content="0;url=https://untrusted.invalid/untrusted-markdown/redirect">
<iframe src="/untrusted-markdown/frame"></iframe>
<object data="/untrusted-markdown/object"></object>
<embed src="/untrusted-markdown/embed">
<form action="/untrusted-markdown/submit"><input autofocus name="password"><button>Send secret</button></form>
<script>window.__markdownExecuted = true</script>
<svg onload="window.__markdownExecuted = true"><image href="/untrusted-markdown/svg-image" /></svg>
<video poster="/untrusted-markdown/poster"><source src="/untrusted-markdown/video"></video>
<img src="/untrusted-markdown/raw.png" srcset="/untrusted-markdown/raw2.png 2x" onerror="window.__markdownExecuted=true">

![Remote tracker](https://untrusted.invalid/untrusted-markdown/track.png)
![Local tracker](/untrusted-markdown/local.png)
![Protocol tracker](//untrusted.invalid/untrusted-markdown/protocol.png)
![Inline tracker](data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=)

[unsafe script](javascript:alert%281%29)
[unsafe entity](jav&#x61;script:alert%281%29)
[unsafe credential](https://user:password@example.test/untrusted-markdown/credential)
[unsafe data](data:text/html;base64,PHNjcmlwdD4=)
[unsafe protocol](//untrusted.invalid/untrusted-markdown/link)
[unsafe file](file:///etc/passwd)

$\htmlStyle{position:fixed;inset:0}{OVERLAY}$

$\htmlId{untrusted-math-id}{x}$

$\htmlClass{untrusted-math-class}{x}$

$\href{javascript:alert(1)}{math link}$

$\href{https://untrusted.invalid/untrusted-markdown/math-link}{math link}$

$\includegraphics{https://untrusted.invalid/untrusted-markdown/math-image}$
`;

export const normalMarkdown = String.raw`
## Approved Markdown

A paragraph with **strong text**, *emphasis*, ~~removed text~~.

> A quotation.

- ordinary list
- [x] completed task

| Label | Value |
| --- | --- |
| sample | 42 |

[Documentation](https://example.test/docs)

[Scoped source](/c/example-chat/files/11111111-1111-4111-8111-111111111111)

A footnote.[^source]

[^source]: A normal citation.

Inline math: $\frac{1}{2} + \sqrt{x}$.

$$
\sum_{i=1}^{n} i = \frac{n(n+1)}{2}
$$
`;

export const fencedCode =
  "```typescript\nconst text = \"<iframe src='/untrusted-markdown/code'></iframe>\";\n```";

export const proseSample =
  `
### Brightest stars

Catalogue values from [the Hipparcos survey](https://example.test/hipparcos), with \`magnitude\` as apparent visual magnitude.

| Star | Constellation | Magnitude |
| --- | --- | --- |
| Sirius | Canis Major | -1.46 |
| Canopus | Carina | -0.74 |
| Arcturus | Boötes | -0.05 |
| Vega | Lyra | 0.03 |

> Vega was the northern pole star around 12,000 BCE and will be again around 13,700 CE.

` +
  "```python\ndef brightest(stars):\n    return sorted(stars, key=lambda star: star.magnitude)[:3]  # lower magnitude is brighter, so sort ascending and keep the first three entries\n```";
