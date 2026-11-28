import { describe, expect, it } from "vitest";
import { PROVIDER_SERVICES } from "@/test/provider-services";
import { OPENAI_BASE_URL } from "./provider-schema";
import { applyChoice, choiceOf, dockerHostUrl } from "./provider-services";

const catalog = PROVIDER_SERVICES;
const OLLAMA = "http://localhost:11434/v1";
const ROUTER = "https://openrouter.ai/api/v1";

describe("choiceOf", () => {
  it("reads OpenAI, a recorded service, or Custom", () => {
    expect(choiceOf({ provider_type: "openai", service: null })).toBe("openai");
    expect(
      choiceOf({ provider_type: "generic_openai", service: "ollama" }),
    ).toBe("ollama");
    expect(choiceOf({ provider_type: "generic_openai" })).toBe("custom");
  });
});

describe("applyChoice", () => {
  it("fills an empty form from the service", () => {
    expect(
      applyChoice({ name: "", base_url: "" }, "custom", "ollama", catalog),
    ).toEqual({
      provider_type: "generic_openai",
      service: "ollama",
      name: "Ollama",
      base_url: OLLAMA,
    });
  });

  it("replaces the previous service's defaults but keeps edits", () => {
    const defaults = { name: "Ollama", base_url: OLLAMA };
    expect(
      applyChoice(defaults, "ollama", "openrouter", catalog),
    ).toMatchObject({ name: "OpenRouter", base_url: ROUTER });
    const edited = { name: "Desk", base_url: "http://gpu-box:11434/v1" };
    expect(applyChoice(edited, "ollama", "openrouter", catalog)).toMatchObject({
      service: "openrouter",
      name: "Desk",
      base_url: "http://gpu-box:11434/v1",
    });
  });

  it("pins OpenAI's URL, and leaving OpenAI drops it", () => {
    const custom = { name: "Mine", base_url: "http://x/v1" };
    expect(applyChoice(custom, "custom", "openai", catalog)).toEqual({
      provider_type: "openai",
      service: null,
      name: "Mine",
      base_url: OPENAI_BASE_URL,
    });
    const openai = { name: "OpenAI", base_url: OPENAI_BASE_URL };
    expect(applyChoice(openai, "openai", "custom", catalog)).toEqual({
      provider_type: "generic_openai",
      service: null,
      name: "",
      base_url: "",
    });
    expect(applyChoice(openai, "openai", "gemini", catalog)).toMatchObject({
      name: "Google Gemini",
      base_url: catalog[0].base_url,
    });
  });

  it("still switches type while the catalog is loading", () => {
    expect(
      applyChoice({ name: "", base_url: "" }, "openai", "custom", undefined),
    ).toMatchObject({ provider_type: "generic_openai", service: null });
  });
});

describe("dockerHostUrl", () => {
  it("swaps a loopback host for host.docker.internal", () => {
    expect(dockerHostUrl(OLLAMA)).toBe("http://host.docker.internal:11434/v1");
    expect(dockerHostUrl("http://127.0.0.1:1337/v1")).toBe(
      "http://host.docker.internal:1337/v1",
    );
    expect(dockerHostUrl("http://localhostess:1/v1")).toBeNull();
    expect(dockerHostUrl("http://gpu-box:8000/v1")).toBeNull();
  });
});
