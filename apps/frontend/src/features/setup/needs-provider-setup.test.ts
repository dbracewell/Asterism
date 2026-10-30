import { expect, it } from "vitest";
import type { LlmDisplayInfo, UserSettings } from "@/lib/client";
import { needsProviderSetup } from "./needs-provider-setup";

const model: LlmDisplayInfo = {
  id: "model",
  name: "Model",
  provider_id: "provider",
  provider_name: "Provider",
  provider_type: "generic_openai",
};
const settings = (models?: LlmDisplayInfo[]) =>
  ({ models }) as unknown as UserSettings;

it("shows the provider step only to an administrator with no active models", () => {
  expect(needsProviderSetup({ role: "admin", settings: settings([]) })).toBe(
    true,
  );
  expect(needsProviderSetup({ role: "admin", settings: settings() })).toBe(
    true,
  );
  expect(
    needsProviderSetup({ role: "admin", settings: settings([model]) }),
  ).toBe(false);
  expect(needsProviderSetup({ role: "user", settings: settings([]) })).toBe(
    false,
  );
});
