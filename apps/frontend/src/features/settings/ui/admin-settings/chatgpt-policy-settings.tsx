"use client";

import { client } from "@/lib/api";
import {
  chatgptPolicyGetOptions,
  chatgptPolicyUpdateMutation,
} from "@/lib/client/@tanstack/react-query.gen";
import { BooleanAdminPolicySettings } from "./boolean-admin-policy-settings";

export function ChatGptPolicySettings() {
  return (
    <BooleanAdminPolicySettings
      policyOptions={chatgptPolicyGetOptions({ client })}
      updateOptions={chatgptPolicyUpdateMutation({ client })}
      policyName="ChatGPT plan policy"
      accessRequired="Administrator access is required to manage ChatGPT plan connections."
      title="ChatGPT plans"
      description="Control whether users can connect their own ChatGPT plan and run chats on it. Disabled by default."
      sectionTitle="Plan connections"
      sectionDescription="Disabling makes plan models unavailable and blocks new connections. Existing connections, chats and sub-agent bindings are kept and are never moved to another model."
      switchLabel="Allow ChatGPT plan connections"
      switchDescription="Each user signs in with their own ChatGPT account. Plan usage runs only on that user's connection and never falls back to another billing source. Sign-in requires the browser to run on the Asterism machine."
    />
  );
}
