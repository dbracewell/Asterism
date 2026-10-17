import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { expect, it, vi } from "vitest";
import { ModelSelector } from "./model-selector";

const models = [
  {
    id: "alpha",
    name: "Alpha",
    provider_name: "Test",
    provider_id: "provider",
  },
  { id: "beta", name: "Beta", provider_name: "Test", provider_id: "provider" },
];

it("tracks the saved binding as models load, refresh, disappear, and the value changes", () => {
  const onChange = vi.fn();
  const { rerender } = render(
    <ModelSelector value="alpha" onValueChange={onChange} />,
  );
  expect(screen.getByRole("button", { expanded: false })).toHaveTextContent(
    "alpha (unavailable)",
  );
  rerender(
    <ModelSelector
      value="alpha"
      availableModels={models}
      onValueChange={onChange}
    />,
  );
  expect(screen.getByRole("button", { expanded: false })).toHaveTextContent(
    "Alpha",
  );
  rerender(
    <ModelSelector
      value="beta"
      availableModels={models}
      onValueChange={onChange}
    />,
  );
  expect(screen.getByRole("button", { expanded: false })).toHaveTextContent(
    "Beta",
  );
  rerender(
    <ModelSelector
      value="beta"
      availableModels={[]}
      disabled
      onValueChange={onChange}
    />,
  );
  expect(screen.getByRole("button", { expanded: false })).toHaveTextContent(
    "beta (unavailable)",
  );
  expect(screen.getByRole("button", { expanded: false })).toBeDisabled();
  expect(onChange).not.toHaveBeenCalled();
});

it("keeps an explicitly selected model when the menu closes", () => {
  function Picker() {
    const [value, setValue] = useState<string>();
    return (
      <>
        <label htmlFor="picker">Model</label>
        <ModelSelector
          id="picker"
          value={value}
          availableModels={models}
          onValueChange={setValue}
        />
      </>
    );
  }
  render(<Picker />);
  expect(screen.getByLabelText("Model")).toHaveTextContent("Select a model");
  fireEvent.click(screen.getByLabelText("Model"));
  fireEvent.click(screen.getByRole("button", { name: "Beta" }));
  expect(screen.getByLabelText("Model")).toHaveTextContent("Beta");
  expect(screen.getByLabelText("Model")).toHaveAttribute(
    "aria-expanded",
    "false",
  );
});
