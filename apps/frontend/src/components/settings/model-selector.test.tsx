import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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
  expect(screen.getByRole("combobox")).toHaveTextContent("alpha (unavailable)");
  rerender(
    <ModelSelector
      value="alpha"
      availableModels={models}
      onValueChange={onChange}
    />,
  );
  expect(screen.getByRole("combobox")).toHaveTextContent("Alpha");
  rerender(
    <ModelSelector
      value="beta"
      availableModels={models}
      onValueChange={onChange}
    />,
  );
  expect(screen.getByRole("combobox")).toHaveTextContent("Beta");
  rerender(
    <ModelSelector
      value="beta"
      availableModels={[]}
      disabled
      onValueChange={onChange}
    />,
  );
  expect(screen.getByRole("combobox")).toHaveTextContent("beta (unavailable)");
  expect(screen.getByRole("combobox")).toBeDisabled();
  expect(onChange).not.toHaveBeenCalled();
});

it("keeps an explicitly selected model when the menu closes", async () => {
  const user = userEvent.setup();
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
  await user.click(screen.getByLabelText("Model"));
  await user.click(await screen.findByRole("option", { name: "Beta" }));
  expect(screen.getByLabelText("Model")).toHaveTextContent("Beta");
  expect(screen.getByLabelText("Model")).toHaveAttribute(
    "aria-expanded",
    "false",
  );
});

it("lists only available models and filters them by name or provider", async () => {
  const user = userEvent.setup();
  render(
    <ModelSelector
      aria-label="Model"
      value="alpha"
      onValueChange={vi.fn()}
      availableModels={[
        ...models,
        { ...models[1], id: "gamma", name: "Gamma", available: false },
        { ...models[1], id: "delta", name: "Delta", provider_name: "Other" },
      ]}
    />,
  );
  await user.click(screen.getByLabelText("Model"));
  expect(await screen.findAllByRole("option")).toHaveLength(3);
  expect(
    screen.queryByRole("option", { name: "Gamma" }),
  ).not.toBeInTheDocument();
  await user.type(screen.getByPlaceholderText("Search models…"), "other");
  await waitFor(() => expect(screen.getAllByRole("option")).toHaveLength(1));
  expect(screen.getByRole("option", { name: "Delta" })).toBeVisible();
});

it("keeps an unavailable saved model visible without listing it", () => {
  render(
    <ModelSelector
      aria-label="Model"
      value="gamma"
      onValueChange={vi.fn()}
      availableModels={[
        ...models,
        { ...models[1], id: "gamma", name: "Gamma", available: false },
      ]}
    />,
  );
  expect(screen.getByLabelText("Model")).toHaveTextContent(
    "Gamma (unavailable)",
  );
});
