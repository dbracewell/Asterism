import { firstChatTourSteps, tourHrefFrom } from "@/features/help/tour";
import type { UserSettings } from "@/lib/client";
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FirstChatTour } from "./first-chat-tour";

const state = vi.hoisted(() => ({
  search: "",
  recorded: null as UserSettings["first_chat_tour"],
  updateSetting: vi.fn(),
  replace: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(state.search),
  useRouter: () => ({ replace: state.replace }),
}));
vi.mock("@/features/auth/components/user-context", () => ({
  useUser: () => ({ settings: { first_chat_tour: state.recorded } }),
}));
vi.mock("@/features/settings/hooks/use-update-user-settings", () => ({
  useUpdateUserSettings: () => ({ updateSetting: state.updateSetting }),
}));

beforeEach(() => {
  state.search = "";
  state.recorded = null;
  state.updateSetting.mockReset();
  state.replace.mockReset();
});

const allTargets = [
  "composer",
  "message",
  "persona",
  "learning-mode",
  "model",
  "attachments",
];

function Composer({ targets }: { targets: string[] }) {
  const has = (target: string) => targets.includes(target);
  return (
    <div data-tour={has("composer") ? "composer" : undefined}>
      <textarea aria-label="Message" data-tour="message" />
      {has("attachments") && (
        <button type="button" data-tour="attachments">
          Add attachments
        </button>
      )}
      {has("model") && (
        <button type="button" data-tour="model">
          Chat model
        </button>
      )}
      {has("persona") && (
        <button type="button" data-tour="persona">
          Chat persona
        </button>
      )}
      {has("learning-mode") && (
        <button type="button" data-tour="learning-mode">
          Learning mode
        </button>
      )}
    </div>
  );
}

function renderTour(
  options: { skillsEnabled?: boolean | undefined; targets?: string[] } = {},
) {
  // An explicit `undefined` means the skill policy is still loading.
  const skillsEnabled =
    "skillsEnabled" in options ? options.skillsEnabled : false;
  const targets = options.targets ?? allTargets;
  const view = render(
    <>
      <FirstChatTour skillsEnabled={skillsEnabled} />
      <Composer targets={targets} />
    </>,
  );
  return {
    ...view,
    rerenderWith: (next: boolean | undefined) =>
      view.rerender(
        <>
          <FirstChatTour skillsEnabled={next} />
          <Composer targets={targets} />
        </>,
      ),
  };
}

const tourDialog = () => screen.getByRole("dialog");
const stepTitle = () =>
  tourDialog().getAttribute("aria-labelledby") &&
  document.getElementById(tourDialog().getAttribute("aria-labelledby")!)
    ?.textContent;

/** Clicks Next through every step; returns the counters and titles seen. */
async function walk(user: ReturnType<typeof userEvent.setup>) {
  const seen: string[] = [];
  const titles: string[] = [];
  for (;;) {
    seen.push(
      within(tourDialog()).getByText(/^Step \d+ of \d+$/).textContent ?? "",
    );
    titles.push(stepTitle() ?? "");
    const next = within(tourDialog()).getByRole("button", {
      name: /^(Next|Finish)$/,
    });
    if (next.textContent === "Finish") return { seen, titles, finish: next };
    await user.click(next);
  }
}

describe("FirstChatTour", () => {
  it("offers the tour on a first visit and records No thanks", async () => {
    const user = userEvent.setup();
    renderTour();
    const offer = screen.getByRole("region", { name: "New here?" });
    await user.click(within(offer).getByRole("button", { name: "No thanks" }));
    expect(state.updateSetting).toHaveBeenCalledWith(
      "first_chat_tour",
      "dismissed",
      false,
    );
    expect(screen.queryByRole("region")).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("waits for the skill policy before offering the tour", () => {
    const view = renderTour({ skillsEnabled: undefined });
    expect(screen.queryByRole("region")).not.toBeInTheDocument();
    view.rerenderWith(true);
    expect(
      screen.getByRole("region", { name: "New here?" }),
    ).toBeInTheDocument();
  });

  it.each(["completed", "dismissed"] as const)(
    "does not offer the tour again once %s",
    (recorded) => {
      state.recorded = recorded;
      renderTour();
      expect(screen.queryByRole("region")).not.toBeInTheDocument();
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    },
  );

  it("walks forward and back, then records completion", async () => {
    const user = userEvent.setup();
    renderTour();
    await user.click(screen.getByRole("button", { name: "Start tour" }));

    // Each step is a named, described dialog that moves focus inside.
    const first = firstChatTourSteps[0];
    expect(tourDialog()).toHaveAccessibleName(first.title);
    expect(tourDialog()).toHaveAccessibleDescription(first.body);
    expect(
      within(tourDialog()).getByRole("button", { name: "Next" }),
    ).toHaveFocus();
    const back = within(tourDialog()).getByRole("button", { name: "Back" });
    expect(back).toHaveAttribute("aria-disabled", "true");
    await user.click(back);
    expect(tourDialog()).toHaveAccessibleName(first.title);

    await user.click(
      within(tourDialog()).getByRole("button", { name: "Next" }),
    );
    expect(tourDialog()).toHaveAccessibleName("Persona");
    await user.click(
      within(tourDialog()).getByRole("button", { name: "Back" }),
    );
    expect(tourDialog()).toHaveAccessibleName(first.title);

    const { seen, titles, finish } = await walk(user);
    expect(titles).not.toContain("Skills");
    // Skills are off here, so five of the six steps are shown.
    expect(seen).toEqual([1, 2, 3, 4, 5].map((n) => `Step ${n} of 5`));
    expect(state.updateSetting).not.toHaveBeenCalled();
    await user.click(finish);
    expect(state.updateSetting).toHaveBeenCalledWith(
      "first_chat_tour",
      "completed",
      false,
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Message" })).toHaveFocus();
  });

  it("announces each step to screen readers", async () => {
    const user = userEvent.setup();
    renderTour();
    await user.click(screen.getByRole("button", { name: "Start tour" }));
    await user.click(
      within(tourDialog()).getByRole("button", { name: "Next" }),
    );
    const persona = firstChatTourSteps.find((step) => step.id === "persona")!;
    const live = tourDialog().querySelector('[aria-live="polite"]');
    expect(live).toHaveTextContent(
      `Step 2 of 5: ${persona.title}. ${persona.body}`,
    );
  });

  it("keeps keyboard focus inside the step", async () => {
    const user = userEvent.setup();
    renderTour();
    await user.click(screen.getByRole("button", { name: "Start tour" }));
    for (let press = 0; press < 6; press++) {
      await user.tab();
      expect(tourDialog()).toContainElement(
        document.activeElement as HTMLElement,
      );
    }
  });

  it("includes the skills step only when skills can be offered", async () => {
    const user = userEvent.setup();
    renderTour({ skillsEnabled: true });
    await user.click(screen.getByRole("button", { name: "Start tour" }));
    const { titles } = await walk(user);
    expect(titles).toEqual(firstChatTourSteps.map((step) => step.title));
  });

  it("skips steps whose control is not on the page", async () => {
    const user = userEvent.setup();
    renderTour({
      targets: allTargets.filter((target) => target !== "persona"),
    });
    await user.click(screen.getByRole("button", { name: "Start tour" }));
    await user.click(
      within(tourDialog()).getByRole("button", { name: "Next" }),
    );
    expect(tourDialog()).toHaveAccessibleName("Learning mode");
    expect(within(tourDialog()).getByText("Step 2 of 4")).toBeInTheDocument();
  });

  it("records Escape and Skip as a dismissal", async () => {
    const user = userEvent.setup();
    renderTour();
    await user.click(screen.getByRole("button", { name: "Start tour" }));
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(state.updateSetting).toHaveBeenCalledWith(
      "first_chat_tour",
      "dismissed",
      false,
    );
  });

  it("restarts from a tour link once skills are known, keeping a completion", async () => {
    const user = userEvent.setup();
    state.recorded = "completed";
    state.search = "project_id=p1&tour=first-chat";
    const view = renderTour({ skillsEnabled: undefined });
    await act(() => new Promise(requestAnimationFrame));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    view.rerenderWith(false);
    await act(() => new Promise(requestAnimationFrame));
    expect(tourDialog()).toHaveAccessibleName(firstChatTourSteps[0].title);
    expect(screen.queryByRole("region")).not.toBeInTheDocument();

    await user.click(
      within(tourDialog()).getAllByRole("button", { name: "Skip tour" })[0],
    );
    // Skipping a replay doesn't overwrite the earlier completion.
    expect(state.updateSetting).not.toHaveBeenCalled();
    expect(state.replace).toHaveBeenCalledWith("/?project_id=p1", {
      scroll: false,
    });
  });
});

describe("tourHrefFrom", () => {
  it("keeps the project on the new-chat page and starts fresh elsewhere", () => {
    expect(tourHrefFrom("/", new URLSearchParams("project_id=p1"))).toBe(
      "/?project_id=p1&tour=first-chat",
    );
    expect(tourHrefFrom("/files", new URLSearchParams("x=1"))).toBe(
      "/?tour=first-chat",
    );
  });
});
