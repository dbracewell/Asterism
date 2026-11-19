import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { GuideMarkdown } from "./guide-markdown";

it("renders guide links, screenshots and heading anchors for the app (US-90.9)", () => {
  render(
    <GuideMarkdown
      file="02-chatting/canvas.md"
      markdown={[
        "# Canvas",
        "",
        "## Good to know",
        "",
        "## Good to know",
        "",
        "See [attaching files](attaching-files.md#before-you-start) and the [deployment guide](../../deployment.md).",
        "",
        "![A canvas](../images/chat-canvas.png)",
        "",
        "<script>alert(1)</script>",
      ].join("\n")}
    />,
  );
  expect(screen.getByRole("link", { name: "attaching files" })).toHaveAttribute(
    "href",
    "/help/guide/02-chatting/attaching-files#before-you-start",
  );
  const outside = screen.getByRole("link", { name: "deployment guide" });
  expect(outside).toHaveAttribute(
    "href",
    "https://github.com/dbracewell/Asterism/blob/main/docs/deployment.md",
  );
  expect(outside).toHaveAttribute("target", "_blank");
  expect(screen.getByRole("img", { name: "A canvas" })).toHaveAttribute(
    "src",
    "/help/guide/images/chat-canvas.png",
  );
  const headings = screen.getAllByRole("heading", { name: "Good to know" });
  expect(headings.map((heading) => heading.id)).toEqual([
    "good-to-know",
    "good-to-know-1",
  ]);
  expect(document.querySelector("script")).toBeNull();
});
