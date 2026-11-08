"use client";

import { LibraryFilePickerDialog } from "@/components/file-manager/library-file-picker";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { FieldGroup } from "@/components/ui/field";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { PROJECT_ACCENTS } from "@/features/projects/project-accent";
import { client } from "@/lib/api";
import type { ProjectAreas, ProjectCreate, UserFile } from "@/lib/client";
import { projectCreateMutation } from "@/lib/client/@tanstack/react-query.gen";
import { useMutation } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { ALL_AREAS, ProjectAreaSwitches } from "./project-areas";
import {
  ProjectAccentField,
  ProjectDescriptionField,
  ProjectGoalFields,
  ProjectInstructionsField,
  ProjectNameField,
} from "./project-fields";

type StartingPointId = "study" | "documents" | "agents" | "blank";

type StartingPoint = {
  label: string;
  summary: string;
  /** Plain-language list of what this starting point sets up. */
  setsUp: string[];
  instructions: string;
  areas: ProjectAreas;
};

/** A starting point only pre-fills fields and areas; all stay editable. */
export const STARTING_POINTS: Record<StartingPointId, StartingPoint> = {
  study: {
    label: "Study a course",
    summary: "Learn from course material with study tools and a goal.",
    setsUp: [
      "Shows Study (flashcards, quizzes, notes), Reflections, Goal and Sub-agents.",
      "Instructions ask for step-by-step explanations that check your understanding.",
    ],
    instructions:
      "Help me learn this course. Explain ideas step by step, check my understanding with short questions, and say which project file an answer comes from.",
    areas: ALL_AREAS,
  },
  documents: {
    label: "Ask my documents",
    summary: "Ask questions about a set of files and get cited answers.",
    setsUp: [
      "Shows Overview, Chats, Files and Settings only.",
      "Instructions ask for answers from the project's files, with the file named.",
    ],
    instructions:
      "Answer from this project's files. Name the file you used, and say so when the files don't cover a question.",
    areas: { study: false, reflections: false, goal: false, sub_agents: false },
  },
  agents: {
    label: "Agent workspace",
    summary: "Hand tasks to your sub-agents and check their work.",
    setsUp: [
      "Shows Sub-agents alongside Overview, Chats, Files and Settings.",
      "Instructions ask the main agent to plan, delegate suitable tasks and check results.",
      "After creating it, choose sub-agents in its Sub-agents tab. Chats can delegate to them only with a model that supports tools.",
    ],
    instructions:
      "Plan the work, hand suitable tasks to the selected sub-agents, and check their results before you answer.",
    areas: { study: false, reflections: false, goal: false, sub_agents: true },
  },
  blank: {
    label: "Blank",
    summary: "Start with nothing filled in and every area shown.",
    setsUp: ["Shows every area. No instructions are filled in."],
    instructions: "",
    areas: ALL_AREAS,
  },
};

type Step = "start" | "details" | "context" | "goal" | "review";

const STEP_LABELS: Record<Step, string> = {
  start: "Starting point",
  details: "Name and description",
  context: "Files and instructions",
  goal: "Goal",
  review: "Review",
};

/** The goal step is skipped while the Goal area is off. */
function wizardSteps(areas: ProjectAreas): Step[] {
  return areas.goal
    ? ["start", "details", "context", "goal", "review"]
    : ["start", "details", "context", "review"];
}

/** Stable, so it runs only when a step's heading mounts, not on every render. */
const focusOnMount = (node: HTMLElement | null) =>
  node?.focus({ preventScroll: true });

const EMPTY: ProjectCreate = {
  name: "",
  description: "",
  system_prompt: "",
  accent: null,
  goal: "",
  goal_target_date: null,
  areas: ALL_AREAS,
};

export function NewProjectWizard() {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!busy) setOpen(next);
      }}
    >
      <DialogTrigger asChild>
        <Button>New project</Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        {/* Content unmounts on close, so every opening starts fresh. */}
        <Wizard onBusy={setBusy} onClose={() => setOpen(false)} />
      </DialogContent>
    </Dialog>
  );
}

function Wizard({
  onBusy,
  onClose,
}: {
  onBusy: (busy: boolean) => void;
  onClose: () => void;
}) {
  const router = useRouter();
  const [start, setStart] = useState<StartingPointId>();
  const [value, setValue] = useState<ProjectCreate>(EMPTY);
  const [files, setFiles] = useState<UserFile[]>([]);
  const [step, setStep] = useState<Step>("start");
  const [picking, setPicking] = useState(false);
  const create = useMutation({
    ...projectCreateMutation({ client }),
    onMutate: () => onBusy(true),
    onSettled: () => onBusy(false),
    onSuccess: (project) => {
      onClose();
      router.push(`/projects/${project.id}`);
    },
  });
  const areas = value.areas ?? ALL_AREAS;
  const steps = wizardSteps(areas);
  const index = steps.indexOf(step);
  const canContinue =
    step === "start"
      ? !!start
      : step === "details"
        ? !!value.name.trim()
        : true;
  const pending = create.isPending;

  const choose = (id: StartingPointId) => {
    const previous = start ? STARTING_POINTS[start].instructions : "";
    const point = STARTING_POINTS[id];
    setStart(id);
    setValue({
      ...value,
      areas: point.areas,
      // Replace the pre-filled text, but never instructions the user wrote.
      system_prompt:
        !value.system_prompt || value.system_prompt === previous
          ? point.instructions
          : value.system_prompt,
    });
  };

  const submit = () =>
    create.mutate({
      body: {
        ...value,
        name: value.name.trim(),
        // A hidden goal would be stored but not shown, so send none.
        goal: areas.goal ? value.goal : "",
        goal_target_date: areas.goal ? value.goal_target_date : null,
        file_ids: files.map((file) => file.id),
      },
    });

  return (
    <form
      className="flex min-w-0 flex-col gap-5"
      onSubmit={(event) => {
        event.preventDefault();
        if (!canContinue || pending) return;
        if (step === "review") submit();
        else setStep(steps[index + 1]);
      }}
    >
      <DialogHeader>
        <DialogTitle>New project</DialogTitle>
        <DialogDescription>
          Step {index + 1} of {steps.length}: {STEP_LABELS[step]}
        </DialogDescription>
      </DialogHeader>
      {/* Remounted per step, so focus moves to the new step's heading. */}
      <h3
        key={step}
        ref={focusOnMount}
        tabIndex={-1}
        className="font-medium outline-none"
      >
        {STEP_LABELS[step]}
      </h3>
      {step === "start" && (
        <StartStep start={start} onChoose={choose} disabled={pending} />
      )}
      {step === "details" && (
        <FieldGroup>
          <ProjectNameField
            value={value}
            onChange={setValue}
            disabled={pending}
          />
          <ProjectDescriptionField
            value={value}
            onChange={setValue}
            disabled={pending}
          />
          <ProjectAccentField
            value={value}
            onChange={setValue}
            disabled={pending}
          />
        </FieldGroup>
      )}
      {step === "context" && (
        <>
          <section aria-label="Files" className="flex flex-col gap-3">
            <p className="text-muted-foreground text-sm">
              Optional. Files you choose are shared with every chat in the
              project. To upload new files, create the project and use its Files
              tab.
            </p>
            <Button
              type="button"
              variant="outline"
              className="self-start"
              disabled={pending}
              onClick={() => setPicking(true)}
            >
              Choose library files
            </Button>
            <LibraryFilePickerDialog
              open={picking}
              onOpenChange={setPicking}
              excludedIds={files.map((file) => file.id)}
              title="Choose library files"
              description="Chosen files are added when you create the project. Nothing changes before then."
              action="Choose"
              unavailableReason="Already chosen"
              onPick={async (picked) =>
                setFiles([
                  ...files,
                  ...picked.filter(
                    (file) => !files.some((chosen) => chosen.id === file.id),
                  ),
                ])
              }
            />
            {files.length > 0 && (
              <ul aria-label="Chosen files" className="flex flex-col gap-1">
                {files.map((file) => (
                  <li
                    key={file.id}
                    className="flex min-w-0 items-center justify-between gap-2"
                  >
                    <span className="truncate text-sm">
                      {file.original_name}
                    </span>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      aria-label={`Remove ${file.original_name}`}
                      disabled={pending}
                      onClick={() =>
                        setFiles(files.filter((item) => item.id !== file.id))
                      }
                    >
                      Remove
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <ProjectInstructionsField
            value={value}
            onChange={setValue}
            disabled={pending}
          />
        </>
      )}
      {step === "goal" && (
        <FieldGroup>
          <p className="text-muted-foreground text-sm">
            Optional. Leave it empty if you don&apos;t have one yet.
          </p>
          <ProjectGoalFields
            value={value}
            onChange={setValue}
            disabled={pending}
          />
        </FieldGroup>
      )}
      {step === "review" && start && (
        <ReviewStep
          start={start}
          value={value}
          files={files}
          disabled={pending}
          onAreas={(next) => setValue({ ...value, areas: next })}
        />
      )}
      {create.error && (
        <p role="alert">
          {create.error.detail ?? "Could not create project."} Nothing was
          created.
        </p>
      )}
      <DialogFooter className="flex-row flex-wrap justify-end gap-2">
        <Button
          type="button"
          variant="ghost"
          disabled={pending}
          onClick={onClose}
        >
          Cancel
        </Button>
        {index > 0 && (
          <Button
            type="button"
            variant="outline"
            disabled={pending}
            onClick={() => setStep(steps[index - 1])}
          >
            Back
          </Button>
        )}
        <Button type="submit" disabled={!canContinue || pending}>
          {step !== "review"
            ? "Next"
            : pending
              ? "Creating…"
              : "Create project"}
        </Button>
      </DialogFooter>
    </form>
  );
}

function StartStep({
  start,
  onChoose,
  disabled,
}: {
  start?: StartingPointId;
  onChoose: (id: StartingPointId) => void;
  disabled: boolean;
}) {
  return (
    <RadioGroup
      aria-label="Starting point"
      value={start ?? ""}
      onValueChange={(id) => onChoose(id as StartingPointId)}
      disabled={disabled}
      className="gap-3"
    >
      {(Object.keys(STARTING_POINTS) as StartingPointId[]).map((id) => {
        const point = STARTING_POINTS[id];
        return (
          <div
            key={id}
            className="rounded-surface flex items-start gap-3 border p-3"
          >
            <RadioGroupItem
              value={id}
              id={`start-${id}`}
              className="mt-1"
              aria-describedby={`start-${id}-details`}
            />
            <div className="flex min-w-0 flex-col gap-1">
              <Label htmlFor={`start-${id}`}>{point.label}</Label>
              <div
                id={`start-${id}-details`}
                className="text-muted-foreground flex flex-col gap-1 text-sm"
              >
                <p>{point.summary}</p>
                <ul className="list-disc pl-5">
                  {point.setsUp.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        );
      })}
    </RadioGroup>
  );
}

function ReviewStep({
  start,
  value,
  files,
  disabled,
  onAreas,
}: {
  start: StartingPointId;
  value: ProjectCreate;
  files: UserFile[];
  disabled: boolean;
  onAreas: (areas: ProjectAreas) => void;
}) {
  const areas = value.areas ?? ALL_AREAS;
  const none = <span className="text-muted-foreground">None</span>;
  return (
    <div className="flex flex-col gap-5">
      <p className="text-muted-foreground text-sm">
        Create project makes exactly this. Nothing is created before then, and
        everything can be changed later in Settings.
      </p>
      <dl className="grid min-w-0 gap-x-4 gap-y-3 text-sm sm:grid-cols-[10rem_1fr]">
        <Row term="Starting point">{STARTING_POINTS[start].label}</Row>
        <Row term="Name">{value.name.trim()}</Row>
        <Row term="Description">{value.description || none}</Row>
        <Row term="Sidebar color">
          {value.accent ? PROJECT_ACCENTS[value.accent].label : none}
        </Row>
        <Row term="Instructions">
          {value.system_prompt ? (
            <span className="whitespace-pre-wrap">{value.system_prompt}</span>
          ) : (
            none
          )}
        </Row>
        <Row term="Files">
          {files.length ? (
            <ul>
              {files.map((file) => (
                <li key={file.id} className="truncate">
                  {file.original_name}
                </li>
              ))}
            </ul>
          ) : (
            none
          )}
        </Row>
        {areas.goal && (
          <Row term="Goal">
            {value.goal ? (
              <>
                {value.goal}
                {value.goal_target_date && ` (by ${value.goal_target_date})`}
              </>
            ) : (
              none
            )}
          </Row>
        )}
        <Row term="Sub-agents">
          None selected yet.
          {areas.sub_agents &&
            " Choose them in the Sub-agents tab after creating the project."}
        </Row>
      </dl>
      <ProjectAreaSwitches
        value={areas}
        onChange={onAreas}
        disabled={disabled}
      />
    </div>
  );
}

function Row({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div className="contents">
      <dt className="font-medium">{term}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </div>
  );
}
