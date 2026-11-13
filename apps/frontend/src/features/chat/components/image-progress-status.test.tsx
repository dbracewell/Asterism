import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { ImageProgressStatus } from "./image-progress-status";

const event = (values: object) => ({
  type: "tool_progress" as const,
  tool_call_id: "direct",
  name: "generate_image",
  stage: "running",
  ...values,
});

it("shows the stage, and a bar once steps are known", () => {
  const { rerender, container } = render(
    <ImageProgressStatus progress={null} />,
  );
  expect(container).toBeEmptyDOMElement();
  rerender(<ImageProgressStatus progress={event({ stage: "loading" })} />);
  expect(screen.getByRole("status")).toHaveTextContent(
    "Loading the image model",
  );
  expect(screen.queryByRole("progressbar")).toBeNull();
  rerender(<ImageProgressStatus progress={event({ step: 3, total: 4 })} />);
  expect(screen.getByRole("status")).toHaveTextContent(
    "Creating the image: step 3 of 4",
  );
  expect(
    screen.getByRole("progressbar", { name: "Image progress" }),
  ).toBeVisible();
});
