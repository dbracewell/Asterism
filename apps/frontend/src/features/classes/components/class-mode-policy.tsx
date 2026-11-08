"use client";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { learningModeQueryOptions } from "@/features/chat/components/chat-learning-mode-picker";
import { errorDetail } from "@/features/classes/error-detail";
import { client } from "@/lib/api";
import type { LearningModeId, TaughtClass } from "@/lib/client";
import { classModePolicyUpdateMutation } from "@/lib/client/@tanstack/react-query.gen";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useId, useState } from "react";
import { HelpHeading } from "@/features/help/components/help-heading";

/** The educator's limits on learning modes in students' course projects (US-60.4). */
export function ClassModePolicy({ item }: { item: TaughtClass }) {
  const prefix = useId();
  const catalog = useQuery(learningModeQueryOptions());
  const modes = catalog.data?.modes ?? [];
  const [allowed, setAllowed] = useState<LearningModeId[] | null>(
    item.allowed_modes ?? null,
  );
  const [reveal, setReveal] = useState(item.answer_reveal);
  const save = useMutation(classModePolicyUpdateMutation({ client }));
  const chosen = allowed ?? modes.map((mode) => mode.id);
  const toggle = (mode: LearningModeId, on: boolean) => {
    const next = on
      ? [...chosen, mode]
      : chosen.filter((existing) => existing !== mode);
    setAllowed(next);
  };
  const allChosen = modes.every((mode) => chosen.includes(mode.id));
  return (
    <section aria-label="Learning mode policy" className="grid gap-3">
      <HelpHeading
        help="concept.class-mode-policy"
        className="text-lg font-medium"
      >
        Learning mode policy
      </HelpHeading>
      <p className="text-sm">
        Applies in your students&apos; course projects. It can only limit what
        they do there; their other chats are unaffected. Students see these
        limits and that you set them.
      </p>
      <fieldset className="grid gap-2">
        <legend className="mb-1 text-sm font-medium">Allowed modes</legend>
        {modes.map((mode) => (
          <div key={mode.id} className="flex items-center gap-2 text-sm">
            <Checkbox
              id={`${prefix}-${mode.id}`}
              checked={chosen.includes(mode.id)}
              onCheckedChange={(checked) => toggle(mode.id, checked === true)}
            />
            <label htmlFor={`${prefix}-${mode.id}`}>{mode.name}</label>
          </div>
        ))}
      </fieldset>
      <div className="flex items-center gap-2 text-sm">
        <Switch
          id={`${prefix}-reveal`}
          checked={reveal}
          onCheckedChange={setReveal}
        />
        <label htmlFor={`${prefix}-reveal`}>
          Let students reveal answers and solutions
        </label>
      </div>
      {chosen.length === 0 && (
        <p role="alert" className="text-destructive text-sm">
          Allow at least one mode.
        </p>
      )}
      <Button
        type="button"
        className="w-fit"
        disabled={save.isPending || chosen.length === 0 || modes.length === 0}
        onClick={() =>
          save.mutate({
            path: { class_id: item.id },
            body: {
              allowed_modes: allChosen ? null : chosen,
              answer_reveal: reveal,
            },
          })
        }
      >
        Save policy
      </Button>
      {save.isSuccess && !save.isPending && (
        <p className="text-sm">
          Policy saved. It applies from the next message.
        </p>
      )}
      {save.error && (
        <p role="alert" className="text-destructive text-sm">
          {errorDetail(save.error, "Could not save the policy.")}
        </p>
      )}
    </section>
  );
}
