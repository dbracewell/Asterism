"use client";

import { client } from "@/lib/api";
import type { CourseModePolicy, LearningModeId } from "@/lib/client";
import { courseModePolicyGetOptions } from "@/lib/client/@tanstack/react-query.gen";
import { useQuery } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import { GraduationCapIcon } from "lucide-react";
import { learningModeQueryOptions } from "./chat-learning-mode-picker";

/** The class policy narrowing a course project, if any (US-60.4). */
export function useCourseModePolicy(projectId: string | null | undefined) {
  const policy = useQuery({
    ...courseModePolicyGetOptions({
      client,
      path: { project_id: projectId ?? "" },
    }),
    enabled: !!projectId,
    retry: false,
  });
  return projectId ? (policy.data ?? null) : null;
}

export function modeAllowed(
  policy: CourseModePolicy | null,
  mode: LearningModeId,
) {
  return !policy?.allowed_modes || policy.allowed_modes.includes(mode);
}

function orList(items: string[]) {
  return items.length > 1
    ? `${items.slice(0, -1).join(", ")} or ${items[items.length - 1]}`
    : (items[0] ?? "no");
}

/** Shows what the educator limited and who set it; heads the mode list. */
export function CoursePolicyNotice({
  policy,
  className,
}: {
  policy: CourseModePolicy | null;
  className?: string;
}) {
  const catalog = useQuery(learningModeQueryOptions());
  if (!policy) return null;
  const names = policy.allowed_modes?.map(
    (mode) =>
      catalog.data?.modes.find((item) => item.id === mode)?.name ?? mode,
  );
  const limits = [
    names && `${orList(names)} ${names.length === 1 ? "mode" : "modes"} only`,
    !policy.answer_reveal && "answers can't be revealed",
  ].filter(Boolean);
  return (
    <p
      aria-label="Course policy"
      className={cn(
        "text-muted-foreground flex items-start gap-1.5 text-xs",
        className,
      )}
    >
      <GraduationCapIcon className="mt-0.5 size-3.5 shrink-0" aria-hidden />
      <span className="wrap-anywhere">
        {policy.class_name}: {limits.join(", ")}. Set by {policy.educator_name}.
      </span>
    </p>
  );
}
