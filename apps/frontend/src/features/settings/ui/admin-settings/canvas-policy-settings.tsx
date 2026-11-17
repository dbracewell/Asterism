"use client";

import { client } from "@/lib/api";
import {
  canvasPolicyGetOptions,
  canvasPolicyUpdateMutation,
} from "@/lib/client/@tanstack/react-query.gen";
import { BooleanAdminPolicySettings } from "./boolean-admin-policy-settings";

export function CanvasPolicySettings() {
  return (
    <BooleanAdminPolicySettings
      policyOptions={canvasPolicyGetOptions({ client })}
      updateOptions={canvasPolicyUpdateMutation({ client })}
      policyName="canvas policy"
      accessRequired="Administrator access is required to manage the canvas."
      title="Canvas"
      description="Control whether the main agent can write documents, code and web pages in a canvas beside the chat. Disabled by default."
      sectionTitle="Availability"
      sectionDescription="Turning the canvas off stops agent and user writes immediately, even during a run. Existing canvas items stay readable and downloadable."
      switchLabel="Enable canvas"
      switchDescription="Each user must also turn the canvas on in their own settings, and the chat's model must support tools. Canvas content grants no tools, files or delegation."
    />
  );
}
