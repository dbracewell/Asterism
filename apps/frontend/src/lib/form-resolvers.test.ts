// Checks the form validation packages after dependency upgrades (US-95.2).
// The app's forms use zodResolver. @hookform/resolvers also brings ajv and
// ajv-formats into the production install, and ajv-formats validates "uri"
// with fast-uri, so the second test loads the copies @hookform/resolvers
// resolves (its ajvResolver needs the optional ajv-errors peer, which is not
// installed).
import { createRequire } from "node:module";
import { zodResolver } from "@hookform/resolvers/zod";
import { describe, expect, it } from "vitest";
import { z } from "zod";

const options = { fields: {}, shouldUseNativeValidation: false } as const;

describe("form resolvers", () => {
  it("validates a URL field with zod", async () => {
    const resolver = zodResolver(z.object({ endpoint: z.url() }));

    const valid = await resolver(
      { endpoint: "https://example.com/v1" },
      undefined,
      options,
    );
    expect(valid.errors).toEqual({});
    expect(valid.values).toEqual({ endpoint: "https://example.com/v1" });

    const invalid = await resolver(
      { endpoint: "not a url" },
      undefined,
      options,
    );
    expect(invalid.values).toEqual({});
    expect(invalid.errors).toHaveProperty("endpoint.message");
  });

  it("validates a uri format with ajv, ajv-formats and fast-uri", () => {
    const fromResolvers = createRequire(
      createRequire(import.meta.url).resolve(
        "@hookform/resolvers/package.json",
      ),
    );
    const Ajv = fromResolvers("ajv").default;
    const addFormats = fromResolvers("ajv-formats").default;
    const ajv = new Ajv({ allErrors: true });
    addFormats(ajv);
    const validate = ajv.compile({
      type: "object",
      properties: { endpoint: { type: "string", format: "uri" } },
      required: ["endpoint"],
      additionalProperties: false,
    });

    expect(validate({ endpoint: "https://example.com/v1?q=1#top" })).toBe(true);
    for (const endpoint of [
      "not a uri",
      "//missing-scheme",
      "http://exa mple.com",
    ]) {
      expect(validate({ endpoint })).toBe(false);
      expect(validate.errors?.[0]).toMatchObject({
        keyword: "format",
        instancePath: "/endpoint",
      });
    }
    expect(validate({})).toBe(false);
    expect(validate.errors?.[0]).toMatchObject({ keyword: "required" });
  });
});
