import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ToolSettings } from "@/lib/client";
import { ToolsSettings } from "./tools-settings";

const mocks = vi.hoisted(() => ({
  save: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: {
    success: mocks.success,
    error: mocks.error,
  },
}));

vi.mock("@/lib/client/@tanstack/react-query.gen", () => ({
  appToolSettingsGetOptions: () => ({
    queryKey: [{ _id: "appToolSettingsGet", baseUrl: "" }],
    queryFn: () => Promise.resolve(settings),
  }),
  appToolSettingsGetQueryKey: () => [
    { _id: "appToolSettingsGet", baseUrl: "" },
  ],
  appToolSettingsUpdateMutation: () => ({ mutationFn: mocks.save }),
  toolsGetAllOptions: () => ({
    queryKey: [{ _id: "toolsGetAll", baseUrl: "" }],
    queryFn: () =>
      Promise.resolve({
        items: [
          {
            name: "web_search",
            description: "Searches the web",
            component_type: "WebSearch",
          },
          {
            name: "image_search",
            description: "Searches images",
            component_type: "ImageSearch",
          },
        ],
      }),
  }),
}));

vi.mock("@/features/settings/ui/admin-settings/component-settings", () => ({
  ComponentSettings: () => <div data-testid="component-settings" />,
}));

const settings: ToolSettings = {
  active_tools: ["web_search"],
  web_search_provider: {
    name: "SearXNG",
    parameters: { base_url: "http://search.local" },
  },
  image_search_provider: {
    name: "Tavily",
    parameters: { api_key: "secret" },
  },
};

function Wrapper({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider
      client={
        new QueryClient({
          defaultOptions: {
            queries: { retry: false },
            mutations: { retry: false },
          },
        })
      }
    >
      {children}
    </QueryClientProvider>
  );
}

describe("tools settings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.save.mockResolvedValue(settings);
  });

  it("preserves focused component selections when saving active tools", async () => {
    const user = userEvent.setup();
    render(<ToolsSettings appSettings={settings} />, { wrapper: Wrapper });

    await screen.findByText("image_search");
    await user.click(screen.getByRole("checkbox", { name: "image_search" }));
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(mocks.save).toHaveBeenCalledOnce());
    expect(mocks.save).toHaveBeenCalledWith(
      expect.objectContaining({
        body: {
          active_tools: ["web_search", "image_search"],
          web_search_provider: settings.web_search_provider,
          image_search_provider: settings.image_search_provider,
        },
      }),
      expect.anything(),
    );
  });
});
