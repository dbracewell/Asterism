// The one SVG sanitizer for drawn diagrams (ADR-0081, ADR-0082). The app's
// markdown viewer imports it, and the server's export renderer loads this file
// into its headless page as an inline module, so both clean diagrams the same
// way. Plain JavaScript with no imports: it runs unbundled in that page.

/**
 * @typedef {{
 *   svg: string,
 *   width: number,
 *   height: number,
 *   label: string,
 *   description: string | null,
 * }} SanitizedDiagram
 */

/**
 * CSS without references outside the document (US-116.2): `@import` rules go,
 * and a `url(...)` that is not a `#fragment` becomes `none`.
 *
 * @param {string} css
 * @returns {string}
 */
export function withoutExternalCss(css) {
  return css
    .replace(/@import[^;]*;?/gi, "")
    .replace(/url\(\s*(["']?)(?!#)[^)]*\)/gi, "none");
}

/**
 * A DOMPurify pass that keeps only static SVG; returns its root element, or
 * null when the markup is not an SVG.
 *
 * @param {(window: Window) => any} createDOMPurify
 * @param {Window} window
 * @param {any} sanitizer The policy's `sanitizer` section.
 * @returns {(svg: string) => Element | null}
 */
function staticSvgPurifier(createDOMPurify, window, sanitizer) {
  const purifier = createDOMPurify(window);
  purifier.addHook("uponSanitizeAttribute", (_node, data) => {
    // Markers and gradients refer to their own document; nothing else may.
    if (
      (data.attrName === "href" || data.attrName === "xlink:href") &&
      !data.attrValue.startsWith(sanitizer.internalHrefPrefix)
    )
      data.keepAttr = false;
  });
  return (svg) => {
    const clean = purifier.sanitize(svg, {
      USE_PROFILES: { ...sanitizer.profiles },
      ADD_TAGS: [...sanitizer.addTags],
      FORBID_TAGS: [...sanitizer.forbidTags],
      FORBID_ATTR: [...sanitizer.forbidAttributes],
      RETURN_DOM_FRAGMENT: true,
    });
    const root = clean.firstElementChild;
    if (!root || root.localName !== "svg") return null;
    for (const style of root.querySelectorAll("style"))
      style.textContent = withoutExternalCss(style.textContent ?? "");
    for (const element of [root, ...root.querySelectorAll("[style]")]) {
      const inline = element.getAttribute("style");
      if (inline !== null)
        element.setAttribute("style", withoutExternalCss(inline));
    }
    return root;
  };
}

/**
 * Makes a sanitizer for SVG files people upload or tools produce (US-116.2):
 * the same static-SVG rules as diagrams, keeping the file's own size.
 *
 * @param {(window: Window) => any} createDOMPurify DOMPurify's factory.
 * @param {Window} window The window whose DOM parses and serializes the SVG.
 * @param {any} policy The parsed `policy.json`.
 * @returns {(svg: string) => string | null} Clean markup, or null when the file is not an SVG.
 */
export function createSvgFileSanitizer(createDOMPurify, window, policy) {
  const purify = staticSvgPurifier(createDOMPurify, window, policy.sanitizer);
  return (svg) => {
    const root = purify(svg);
    return root ? new window.XMLSerializer().serializeToString(root) : null;
  };
}

/**
 * Makes a sanitizer bound to its own DOMPurify instance, so its hook never
 * changes how mermaid sanitizes labels with the default instance.
 *
 * @param {(window: Window) => any} createDOMPurify DOMPurify's factory.
 * @param {Window} window The window whose DOM parses and serializes the SVG.
 * @param {any} policy The parsed `policy.json`.
 * @returns {(svg: string, names?: { title?: string | null, description?: string | null }) => SanitizedDiagram | null}
 *   `names` (from `prepareDiagramSource`) name a diagram whose SVG carries no
 *   title or description, such as a mind map or a timeline.
 */
export function createDiagramSanitizer(createDOMPurify, window, policy) {
  const { sanitizer, labelLimits } = policy;
  const purify = staticSvgPurifier(createDOMPurify, window, sanitizer);

  /**
   * Keeps only static SVG: no scripts, event attributes, foreign HTML,
   * embedded images, links or stylesheets out of the document. Returns
   * standalone markup with an explicit size, or null when nothing drawable
   * is left.
   */
  return function sanitizeDiagramSvg(svg, names) {
    const root = purify(svg);
    if (!root) return null;
    const box = root
      .getAttribute("viewBox")
      ?.trim()
      .split(/[\s,]+/)
      .map(Number);
    const [width, height] =
      box?.length === 4 && box.every(Number.isFinite) ? box.slice(2) : [0, 0];
    if (!(width > 0 && height > 0)) return null;
    // Mermaid sizes the SVG for inline use (width="100%", max-width style). As
    // a standalone image it needs its own size.
    root.setAttribute("width", String(Math.ceil(width)));
    root.setAttribute("height", String(Math.ceil(height)));
    root.removeAttribute("style");
    const title =
      root.querySelector(":scope > title")?.textContent?.trim() ||
      names?.title?.trim();
    const description =
      root.querySelector(":scope > desc")?.textContent?.trim() ||
      names?.description?.trim() ||
      null;
    // Mermaid's internal names carry a version ("flowchart-v2").
    const type = root
      .getAttribute("aria-roledescription")
      ?.trim()
      .replace(/-v\d+$/, "");
    return {
      svg: new window.XMLSerializer().serializeToString(root),
      width: Math.ceil(width),
      height: Math.ceil(height),
      label: (title || (type ? `Diagram: ${type}` : "Diagram")).slice(
        0,
        labelLimits.name,
      ),
      description: description?.slice(0, labelLimits.description) ?? null,
    };
  };
}
