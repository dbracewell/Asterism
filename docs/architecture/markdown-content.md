# Markdown and file-content trust boundary

## Decision — US-31.3

`MarkdownViewer` owns the content policy for main chat messages (including user
messages) and sub-agent replies. Its inputs may include model output, user prompts,
file-derived text and retrieval-derived text. Those inputs do not grant HTML,
network-resource, file or tool capabilities.

The renderer parses CommonMark plus GFM and math. **Raw HTML is disabled**:
`react-markdown` uses `skipHtml`, and the raw-HTML parser dependency was removed.
There is no raw-HTML mode or caller-supplied plugin/URL-policy override. This is a
clean change to accepted content, not an HTML compatibility layer. Depending on
Markdown parsing context, HTML source is omitted or remains literal text; its
markup/attributes are never installed as DOM elements.

## Content and resource policy

| Input             | Behavior                                                                                                                                                                  |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Standard Markdown | Headings, paragraphs, emphasis, quotations, lists, inline code and fenced code remain supported.                                                                          |
| GFM               | Tables, strikethrough, footnotes and disabled task-list checkboxes remain supported.                                                                                      |
| Raw HTML          | No user HTML elements, styles, classes, event handlers, forms, frames, scripts, media, metadata or SVG are installed.                                                     |
| Markdown images   | Always display an omitted-image label with the alt text. No `img`, `src`, `srcset` or network request is produced.                                                        |
| Resource URLs     | All untrusted automatic resources are blocked, including remote, protocol-relative, same-origin, data and blob image URLs.                                                |
| Links             | Explicit HTTP(S) URLs without credentials, application paths beginning with a single `/`, and document fragments beginning with `#` are allowed.                          |
| Other URLs        | Script/data/blob/file/FTP/mailto schemes, protocol-relative URLs, backslashes, whitespace/control characters, path-relative links and query-only links are not clickable. |
| Code blocks       | Code is literal text, highlighted and copyable. HTML inside code cannot create active elements.                                                                           |
| Math              | KaTeX generates approved math markup under the fixed settings below.                                                                                                      |

Links are ordinary anchors requiring an explicit click, with `rel="noreferrer
noopener"`. The renderer does not use Next.js link prefetching or automatically
follow content URLs. Blocked links retain their text without an `href`.
The shared URL transform permits only anchor `href` values; no resource attribute
can pass through it. No inline-image loading/approval flow is implemented.
Authorized attachment previews remain separate application components; Markdown
cannot turn an arbitrary endpoint into an authenticated image request.

## Math policy and pipeline

`remark-gfm` and `remark-math` run before `rehype-katex`. Raw source HTML is never
reparsed into an element tree. KaTeX uses `output: "html"`, `trust: false`,
`strict: "error"`, `throwOnError: false`, `maxSize: 20` and `maxExpand: 1000`.
These settings cover inline math, display math and math fences.

Untrusted input cannot enable HTML/style/ID/class extensions, hyperlinks or
`includegraphics` through math. Invalid and over-expanding expressions render an
inert error representation rather than throwing through the application. Standard
fractions, roots, sums and display equations remain supported. KaTeX's own generated
spans, SVG paths and inline layout styles are trusted renderer output; they are not
user-supplied HTML. The dependency remains part of the trusted implementation.

See the primary [react-markdown security and HTML documentation](https://github.com/remarkjs/react-markdown#security)
and [KaTeX options](https://katex.org/docs/options) for the library boundaries.

## Files, citations, and scope

The current `FileView` renders extracted content in a React text node inside
`pre`, and captions as ordinary React text. It does not render file HTML or run a
second Markdown parser. Adversarial file text remains literal. If another file
surface later adopts rich rendering, it must use this shared policy.

Markdown footnotes and application-path references remain usable. Structured
`RetrievalCitations` remain independent of Markdown, obtain file metadata through
the generated client and current chat scope, and use the existing scoped-file
route. Neither a Markdown link nor a citation label grants file permission;
server-side authorization still governs access. Existing authorized attachment
image components are not controlled by untrusted Markdown source URLs.

## Verification and remaining work

Unit tests exercise raw overlays/forms/frames/media, dangerous and entity-encoded
URLs, credential-bearing URLs, same-origin/remote/data/blob images, math HTML/link/
image commands, bounded math size/expansion, streamed fragments, GFM, footnotes and
literal copyable code. Browser coverage intercepts every adversarial resource URL
and verifies zero requests while exercising the shared renderer, actual sub-agent
panel, scoped citation component and plain-text file preview with synthetic data.

[US-31.3 verification](../reviews/us-31.3-verification-2026-10-18.md) records executed
gates and limitations. This policy closes the content trust boundary. Rich-content
wrapping, nested scroll areas and composer clearance remain US-32.3; unrestricted
HTML is not a prerequisite for that layout work.
