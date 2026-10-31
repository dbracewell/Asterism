import { describe, expect, it } from "vitest";
import { applySuggestion } from "./coach";

const suggestion = (find: string | null, text: string) => ({
  id: "goal",
  criterion: "goal" as const,
  message: "Be specific.",
  find,
  text,
});

describe("applySuggestion", () => {
  it("replaces the first exact occurrence of the reviewed text", () => {
    expect(
      applySuggestion(
        "Write about dogs. More dogs.",
        suggestion("dogs", "puppies"),
      ),
    ).toBe("Write about puppies. More dogs.");
  });

  it("cannot apply a rewrite once the text has been edited away", () => {
    expect(applySuggestion("Write about cats.", suggestion("dogs", "x"))).toBe(
      null,
    );
  });

  it("appends an addition as a new paragraph, once", () => {
    const added = applySuggestion(
      "Write about dogs.\n\n",
      suggestion(null, "Keep it short."),
    );
    expect(added).toBe("Write about dogs.\n\nKeep it short.");
    expect(applySuggestion(added!, suggestion(null, "Keep it short."))).toBe(
      null,
    );
    expect(applySuggestion("", suggestion(null, "Hi."))).toBe("Hi.");
  });
});
