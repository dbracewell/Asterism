"use client";
import { defaultPersonaProvenance } from "@/test/personas";

import { Button } from "@/components/ui/button";
import {
  ExistingChatModelPicker,
  ExecutionLabel,
} from "@/features/chat/components/chat-model-picker";
import { ChatInfo, MessageExecution } from "@/lib/client";
import { useState } from "react";
const model = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Alpha",
  provider_id: "33333333-3333-4333-8333-333333333333",
  provider_name: "Provider",
  provider_type: "generic_openai" as const,
  available: true,
};
const historical: MessageExecution = {
  persona: defaultPersonaProvenance,
  id: "44444444-4444-4444-8444-444444444444",
  request_message_id: "55555555-5555-4555-8555-555555555555",
  model_revision: 1,
  model,
  configuration: {
    id: "66666666-6666-4666-8666-666666666666",
    name: "Main",
    description: "",
    config_revision: 1,
  },
};
export function ChatModelsHarness() {
  const [info, setInfo] = useState<ChatInfo>({
    id: "77777777-7777-4777-8777-777777777777",
    user_id: "test",
    created_at: 0,
    updated_at: 0,
    selected_model_id: model.id,
    selected_model: model,
    model_revision: 1,
  });
  const [active, setActive] = useState(false);
  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-4 p-8">
      <ExistingChatModelPicker
        info={info}
        disabled={active}
        onSelected={setInfo}
      />
      <p role="status">Selection revision: {info.model_revision}</p>
      <Button onClick={() => setActive(!active)}>
        {active ? "End simulated run" : "Simulate active run"}
      </Button>
      <section aria-label="Historical assistant output">
        <p>Previous answer</p>
        <ExecutionLabel execution={historical} />
      </section>
    </main>
  );
}
