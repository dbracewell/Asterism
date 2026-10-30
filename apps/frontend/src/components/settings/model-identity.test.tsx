import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import {
  CapabilityIcons,
  capabilityLabels,
  ProviderIcon,
  ProviderTypeLabel,
} from "./model-identity";
import { ModelSelector } from "./model-selector";

describe("provider identity", () => {
  it("names every provider type in text and as a labelled image", () => {
    render(
      <>
        <ProviderTypeLabel type="openai" />
        <ProviderIcon type="generic_openai" labelled />
      </>,
    );
    expect(screen.getByText("OpenAI")).toBeVisible();
    const icon = screen.getByRole("img", { name: "OpenAI-compatible" });
    expect(icon).toHaveAttribute("title", "OpenAI-compatible");
    // The glyph draws with currentColor so it follows the theme's text color.
    expect(icon.querySelector("svg")).toHaveAttribute("stroke", "currentColor");
  });

  it("keeps a decorative provider icon out of the accessibility tree", () => {
    const { container } = render(<ProviderIcon type="openai" />);
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(container.firstChild).toHaveAttribute("title", "OpenAI");
  });
});

describe("capability badges", () => {
  it("labels supported capabilities and omits unsupported or unknown ones", () => {
    render(
      <CapabilityIcons
        model={{ supports_tools: true, supports_vision: false }}
      />,
    );
    const tools = screen.getByRole("img", { name: "Tool calling" });
    expect(tools).toHaveAttribute("title", "Tool calling");
    expect(
      screen.queryByRole("img", { name: "Vision input" }),
    ).not.toBeInTheDocument();
  });

  it("states every capability, including unsupported and unknown", () => {
    expect(capabilityLabels({ supports_tools: false })).toEqual([
      "Tools unsupported",
      "Image support unknown",
    ]);
    expect(
      capabilityLabels({ supports_tools: true, supports_vision: true }),
    ).toEqual(["Tools supported", "Images supported"]);
  });

  it("renders nothing for a model without supported capabilities", () => {
    const { container } = render(<CapabilityIcons model={{}} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("model options", () => {
  it("keeps the model label as the option name and describes its identity", async () => {
    const user = userEvent.setup();
    render(
      <ModelSelector
        aria-label="Model"
        onValueChange={vi.fn()}
        showProvider
        showCapabilities
        availableModels={[
          {
            id: "vision",
            name: "Vision",
            provider_id: "p",
            provider_name: "Cloud",
            provider_type: "openai",
            supports_tools: true,
            supports_vision: true,
          },
          {
            id: "local",
            name: "Local",
            provider_id: "q",
            provider_name: "Lab",
            provider_type: "generic_openai",
            supports_tools: false,
          },
        ]}
      />,
    );
    await user.click(screen.getByLabelText("Model"));
    const vision = await screen.findByRole("option", {
      name: "Vision (Cloud)",
    });
    expect(vision).toHaveAccessibleDescription(
      "OpenAI provider. Tools supported. Images supported",
    );
    expect(vision.querySelector('[title="Tool calling"]')).not.toBeNull();
    expect(vision.querySelector('[title="Vision input"]')).not.toBeNull();
    const local = screen.getByRole("option", { name: "Local (Lab)" });
    expect(local).toHaveAccessibleDescription(
      "OpenAI-compatible provider. Tools unsupported. Image support unknown",
    );
    expect(local.querySelector('[title="Tool calling"]')).toBeNull();
    // Icons inside options are decorative; the description carries the text.
    expect(screen.queryAllByRole("img")).toHaveLength(0);
  });

  it("describes only the provider type when capabilities are hidden", async () => {
    const user = userEvent.setup();
    render(
      <ModelSelector
        aria-label="Model"
        onValueChange={vi.fn()}
        availableModels={[
          {
            id: "a",
            name: "Alpha",
            provider_id: "p",
            provider_name: "Cloud",
            provider_type: "openai",
            supports_tools: true,
          },
        ]}
      />,
    );
    await user.click(screen.getByLabelText("Model"));
    const option = await screen.findByRole("option", { name: "Alpha" });
    expect(option).toHaveAccessibleDescription("OpenAI provider");
    expect(option.querySelector('[title="Tool calling"]')).toBeNull();
  });
});
