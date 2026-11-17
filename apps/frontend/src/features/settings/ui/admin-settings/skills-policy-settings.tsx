"use client";

import { client } from "@/lib/api";
import {
  skillsPolicyGetOptions,
  skillsPolicyUpdateMutation,
} from "@/lib/client/@tanstack/react-query.gen";
import { BooleanAdminPolicySettings } from "./boolean-admin-policy-settings";

export function SkillsPolicySettings() {
  return (
    <BooleanAdminPolicySettings
      policyOptions={skillsPolicyGetOptions({ client })}
      updateOptions={skillsPolicyUpdateMutation({ client })}
      policyName="skill policy"
      accessRequired="Administrator access is required to manage skill activation."
      title="Skills"
      description="Control whether users can activate their assigned instruction skills in chat. Disabled by default."
      sectionTitle="Activation"
      sectionDescription="Disabling blocks execution and follow-ups that use active skills until those skills are removed. Private documents, assignments, and historical snapshots remain saved."
      switchLabel="Enable skill activation"
      switchDescription="Users must still own each skill and assign it to their main agent. Enabling this policy grants no tools, files, MCP access, or delegation."
    />
  );
}
