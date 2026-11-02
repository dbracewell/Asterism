import { expect, it } from "vitest";
import { copyableText } from "./copy-text";

const A = "10000000-0000-4000-8000-000000000001";
const B = "10000000-0000-4000-8000-000000000002";

it("replaces file references with labels or file names", () => {
  const files = [
    { file_id: A, available: true, name: "chart.png" },
    { file_id: B, available: false, name: "gone.png" },
  ];
  expect(
    copyableText(
      `See ![Quarterly chart](asterism-file:${A}), ![](asterism-file:${A}), ` +
        `[the deck](asterism-file:${B}) and ![](asterism-file:${B}).`,
      files,
    ),
  ).toBe("See Quarterly chart, chart.png, the deck and file.");
});

it("leaves ordinary links and near-misses alone", () => {
  const text = `[docs](https://example.test) ![x](asterism-file:${A}?x=1) asterism-file:${A}`;
  expect(copyableText(text)).toBe(text);
});
