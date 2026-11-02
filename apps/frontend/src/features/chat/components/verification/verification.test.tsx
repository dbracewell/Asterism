import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createRef } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { StreamingMessage } from "@/features/chat/types";
import { findQuoteRange } from "@/features/chat/lib/claim-highlights";
import type { MessageVerification } from "@/lib/client";
import { VerificationPanel, usageSummary } from "./verification-panel";
import { VerifyAction } from "./verify-dialog";

const mocks = vi.hoisted(() => ({ models: vi.fn(), verify: vi.fn() }));
vi.mock("@/lib/api", () => ({ client: {} }));
vi.mock("@/features/auth/components/user-context", () => ({
  useUser: () => ({ settings: { default_model_id: "m2" } }),
}));
vi.mock("@/components/settings/model-selector", () => ({
  ModelSelector: ({
    id,
    value,
    onValueChange,
    availableModels,
  }: {
    id: string;
    value?: string;
    onValueChange: (value: string) => void;
    availableModels: { id: string; name: string }[];
  }) => (
    <select
      id={id}
      value={value}
      onChange={(event) => onValueChange(event.target.value)}
    >
      {availableModels.map((model) => (
        <option key={model.id} value={model.id}>
          {model.name}
        </option>
      ))}
    </select>
  ),
}));
vi.mock("@/lib/client/@tanstack/react-query.gen", () => ({
  chatModelsListOptions: () => ({
    queryKey: ["models"],
    queryFn: () => mocks.models(),
  }),
  chatMessageVerifyMutation: () => ({ mutationFn: mocks.verify }),
}));

const FILE = "10000000-0000-4000-8000-000000000001";
const verification: MessageVerification = {
  model_id: "m1",
  model_name: "Checker",
  created_at: Date.UTC(2026, 10, 2, 12),
  file_ids: [FILE],
  claims: [
    {
      claim: "The sky is blue.",
      quote: "The sky is blue.",
      label: "supported",
      explanation: "Stated <b>directly</b>.",
      evidence: [
        {
          file_id: FILE,
          chunk_id: "c1",
          artifact_generation: 1,
          name: "notes.md",
          excerpt: "The sky is blue on clear days.",
          available: true,
        },
      ],
    },
    {
      claim: "Water boils at 50 C.",
      quote: null,
      label: "contradicted",
      explanation: "The notes say 100 C.",
      evidence: [
        {
          file_id: FILE,
          chunk_id: "c2",
          artifact_generation: 1,
          name: "gone.md",
          excerpt: "Water boils at 100 C.",
          available: false,
        },
      ],
    },
    {
      claim: "Mars has two moons.",
      label: "unchecked",
      explanation: "Not checked: the verify time limit was reached.",
      evidence: [],
    },
  ],
  usage: {
    claims_found: 14,
    claims_checked: 2,
    claim_limit: 12,
    claims_truncated: true,
    answer_truncated: false,
    timed_out: true,
    searches: 3,
    model_calls: 3,
    input_tokens: 1200,
    output_tokens: 80,
    duration_ms: 4200,
  },
};

const wrap = (ui: React.ReactNode) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <TooltipProvider>{ui}</TooltipProvider>
    </QueryClientProvider>,
  );
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.models.mockResolvedValue([
    { id: "m1", name: "Answer model", available: true },
    { id: "m2", name: "Default", available: true },
  ]);
});

describe("findQuoteRange", () => {
  it("matches across inline formatting and whitespace", () => {
    const root = document.createElement("div");
    root.innerHTML = "<p>Intro. The <strong>sky</strong>\n  is blue. End.</p>";
    const range = findQuoteRange(root, "The sky is   blue.");
    expect(range?.toString()).toBe("The sky\n  is blue.");
    expect(findQuoteRange(root, "not there")).toBeNull();
    expect(findQuoteRange(root, "   ")).toBeNull();
  });
});

describe("VerificationPanel", () => {
  it("lists labels, evidence, provenance and limits as text", async () => {
    const user = userEvent.setup();
    wrap(
      <VerificationPanel
        chatId="chat"
        messageId="msg"
        verification={verification}
        answerRef={createRef()}
      />,
    );
    const trigger = screen.getByRole("button", { name: /Verification/ });
    expect(trigger).toHaveTextContent(
      "1 contradicted · 1 supported · 1 not checked",
    );
    await user.click(trigger);
    expect(screen.getByText(/Checked by Checker on/)).toHaveTextContent(
      "against 1 file",
    );
    expect(
      screen.getByText("Only the first 12 claims were checked."),
    ).toBeVisible();
    expect(
      screen.getByText(
        "The time limit was reached before every claim was checked.",
      ),
    ).toBeVisible();

    const claims = within(
      screen.getByRole("list", { name: "Verified claims" }),
    ).getAllByRole("listitem", { name: "" });
    const items = claims.filter((item) => item.dataset.claimLabel);
    expect(items.map((item) => item.dataset.claimLabel)).toEqual([
      "supported",
      "contradicted",
      "unchecked",
    ]);
    expect(items[0]).toHaveTextContent("Supported");
    // Untrusted explanations stay text.
    expect(within(items[0]).getByText("Stated <b>directly</b>.")).toBeVisible();
    expect(document.querySelector("b")).toBeNull();

    const evidence = screen.getByRole("link", { name: "Evidence: notes.md" });
    expect(evidence).toHaveAttribute("href", `/c/chat/files/${FILE}`);
    await user.hover(evidence);
    expect(
      await screen.findByRole("tooltip", { name: /notes\.md/ }),
    ).toHaveTextContent("The sky is blue on clear days.");
    expect(
      screen.getByRole("note", { name: "Evidence unavailable: gone.md" }),
    ).toBeVisible();
    expect(screen.queryByRole("link", { name: /gone\.md/ })).toBeNull();
  });

  it("summarizes usage", () => {
    expect(usageSummary(verification)).toBe(
      "2 of 14 claims checked · 3 model calls · 3 searches · 1,200 in / 80 out tokens · 4.2 s",
    );
  });
});

const message = (extra: Partial<StreamingMessage> = {}) =>
  ({
    id: "msg",
    role: "assistant",
    status: "completed",
    content: "The sky is blue.",
    created_at: 0,
    execution: {
      model: { id: "m1" },
      context: { allowed_file_ids: [FILE, FILE] },
    },
    ...extra,
  }) as unknown as StreamingMessage;

describe("VerifyAction", () => {
  it("is offered only for completed answers with recorded files", () => {
    const { container } = wrap(
      <>
        <VerifyAction
          chatId="chat"
          message={message({ status: "pending" })}
          disabled={false}
        />
        <VerifyAction
          chatId="chat"
          message={message({ execution: undefined })}
          disabled={false}
        />
        <VerifyAction
          chatId="chat"
          message={message({ role: "user" })}
          disabled={false}
        />
      </>,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("verifies with the answer's model by default and closes on success", async () => {
    const user = userEvent.setup();
    mocks.verify.mockResolvedValue(verification);
    wrap(<VerifyAction chatId="chat" message={message()} disabled={false} />);
    await user.click(
      screen.getByRole("button", { name: "Verify against sources" }),
    );
    const dialog = screen.getByRole("dialog", { name: "Verify this answer" });
    expect(dialog).toHaveTextContent("against the 2 files this answer");
    await waitFor(() =>
      expect(within(dialog).getByLabelText("Model")).toHaveValue("m1"),
    );
    await user.click(within(dialog).getByRole("button", { name: "Verify" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(mocks.verify.mock.calls[0][0]).toEqual({
      path: { chat_id: "chat", message_id: "msg" },
      body: { model_id: "m1" },
    });
  });

  it("shows the server's reason when verifying fails", async () => {
    const user = userEvent.setup();
    mocks.verify.mockRejectedValue({
      detail: "Knowledge search is turned off",
    });
    wrap(
      <VerifyAction
        chatId="chat"
        message={message({ verification })}
        disabled={false}
      />,
    );
    await user.click(
      screen.getByRole("button", { name: "Verify against sources" }),
    );
    expect(screen.getByRole("dialog")).toHaveTextContent(
      "This replaces the previous verification.",
    );
    await user.click(screen.getByRole("button", { name: "Verify again" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Knowledge search is turned off",
    );
    expect(screen.getByRole("dialog")).toBeVisible();
  });
});
