"use client";

import { useConfirmationDialog } from "@/components/confirmation-dialog";
import { ListSkeleton } from "@/components/loading-skeletons";
import { QueryError } from "@/components/query-error";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { errorDetail } from "@/features/classes/error-detail";
import { HelpTopic } from "@/features/help/components/help-topic";
import { client } from "@/lib/api";
import type { Group, GroupAccessOptions } from "@/lib/client";
import {
  groupAccessOptionsOptions,
  groupAccessUpdateMutation,
  groupCreateMutation,
  groupDeleteMutation,
  groupGetManyOptions,
  groupRenameMutation,
} from "@/lib/client/@tanstack/react-query.gen";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useId, useState } from "react";

const MAX_NAME = 80;

type Choice = { id: string; label: string; detail?: string; enabled: boolean };

/** "All enabled" (null) or an explicit list, as the API stores it. */
function AccessList({
  title,
  allLabel,
  choices,
  value,
  onChange,
  disabled,
}: {
  title: string;
  allLabel: string;
  choices: Choice[];
  value: string[] | null;
  onChange: (value: string[] | null) => void;
  disabled: boolean;
}) {
  const id = useId();
  const selected = new Set(value ?? []);
  return (
    <fieldset className="grid gap-2" disabled={disabled}>
      <legend className="mb-1 font-medium">{title}</legend>
      <RadioGroup
        aria-label={title}
        value={value === null ? "all" : "some"}
        onValueChange={(next) => onChange(next === "all" ? null : [])}
      >
        <div className="flex items-center gap-2">
          <RadioGroupItem id={`${id}-all`} value="all" />
          <Label htmlFor={`${id}-all`}>{allLabel}</Label>
        </div>
        <div className="flex items-center gap-2">
          <RadioGroupItem id={`${id}-some`} value="some" />
          <Label htmlFor={`${id}-some`}>Only the ones checked below</Label>
        </div>
      </RadioGroup>
      {value !== null && (
        <ul className="grid gap-1.5 pl-6">
          {choices.length === 0 && (
            <li className="text-muted-foreground text-sm">Nothing to list.</li>
          )}
          {choices.map((choice) => (
            <li key={choice.id} className="flex items-start gap-2">
              <Checkbox
                id={`${id}-${choice.id}`}
                checked={selected.has(choice.id)}
                onCheckedChange={(checked) =>
                  onChange(
                    checked
                      ? [...(value ?? []), choice.id]
                      : (value ?? []).filter((item) => item !== choice.id),
                  )
                }
              />
              <Label
                htmlFor={`${id}-${choice.id}`}
                className="grid gap-0.5 font-normal"
              >
                <span>
                  {choice.label}
                  {!choice.enabled && (
                    <span className="text-muted-foreground">
                      {" "}
                      (turned off for everyone)
                    </span>
                  )}
                </span>
                {choice.detail && (
                  <span className="text-muted-foreground text-xs">
                    {choice.detail}
                  </span>
                )}
              </Label>
            </li>
          ))}
        </ul>
      )}
    </fieldset>
  );
}

function AccessEditor({
  group,
  options,
}: {
  group: Group;
  options: GroupAccessOptions;
}) {
  const [models, setModels] = useState(group.models ?? null);
  const [tools, setTools] = useState(group.tools ?? null);
  const [saved, setSaved] = useState(false);
  const save = useMutation({
    ...groupAccessUpdateMutation({ client }),
    onSuccess: () => setSaved(true),
  });
  return (
    <form
      className="grid gap-4 pt-3"
      onSubmit={(event) => {
        event.preventDefault();
        save.mutate({ path: { group_id: group.id }, body: { models, tools } });
      }}
    >
      <AccessList
        title="Models"
        allLabel="Every enabled model, including ones added later"
        choices={options.models.map((model) => ({
          id: model.id,
          label: model.name,
          detail: model.provider_name,
          enabled: model.enabled,
        }))}
        value={models}
        onChange={(next) => {
          setSaved(false);
          setModels(next);
        }}
        disabled={save.isPending}
      />
      <AccessList
        title="Tools"
        allLabel="Every enabled tool, including ones added later"
        choices={options.tools.map((tool) => ({
          id: tool.name,
          label: tool.name,
          detail: tool.description,
          enabled: tool.enabled,
        }))}
        value={tools}
        onChange={(next) => {
          setSaved(false);
          setTools(next);
        }}
        disabled={save.isPending}
      />
      <p className="text-muted-foreground text-xs">
        A group can only narrow what is turned on in Providers and Tools.
        Members&apos; own ChatGPT plan models aren&apos;t limited here.
      </p>
      {save.error && (
        <p role="alert" className="text-destructive text-sm">
          {errorDetail(save.error, "Could not save access.")}
        </p>
      )}
      {saved && (
        <p role="status" className="text-sm">
          Access saved. It applies to {group.name} from their next request.
        </p>
      )}
      <Button type="submit" className="w-fit" disabled={save.isPending}>
        {save.isPending ? "Saving…" : `Save access for ${group.name}`}
      </Button>
    </form>
  );
}

function RenameForm({ group, done }: { group: Group; done: () => void }) {
  const [name, setName] = useState(group.name);
  const rename = useMutation({
    ...groupRenameMutation({ client }),
    onSuccess: done,
  });
  return (
    <form
      className="flex flex-wrap items-center gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        rename.mutate({
          path: { group_id: group.id },
          body: { name: name.trim() },
        });
      }}
    >
      <Input
        aria-label={`New name for ${group.name}`}
        className="w-60"
        maxLength={MAX_NAME}
        value={name}
        onChange={(event) => setName(event.target.value)}
      />
      <Button type="submit" disabled={!name.trim() || rename.isPending}>
        Save name
      </Button>
      <Button type="button" variant="outline" onClick={done}>
        Cancel
      </Button>
      {rename.error && (
        <p role="alert" className="text-destructive w-full text-sm">
          {errorDetail(rename.error, "Could not rename the group.")}
        </p>
      )}
    </form>
  );
}

function GroupRow({
  group,
  options,
}: {
  group: Group;
  options?: GroupAccessOptions;
}) {
  const [renaming, setRenaming] = useState(false);
  const remove = useMutation(groupDeleteMutation({ client }));
  const { confirm, dialog } = useConfirmationDialog({
    title: `Delete ${group.name}?`,
    description:
      "Only an empty group can be deleted. Move its members to another group from Users first.",
    confirmVariant: "destructive",
  });
  const summary = (list: unknown[] | null | undefined, noun: string) =>
    list == null
      ? `all ${noun}`
      : `${list.length} ${list.length === 1 ? noun.slice(0, -1) : noun}`;
  return (
    <li
      aria-label={group.name}
      className="rounded-surface grid gap-2 border p-3 text-sm"
    >
      {dialog}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex flex-wrap items-center gap-2">
          <span className="font-medium wrap-anywhere">{group.name}</span>
          {group.built_in && <Badge variant="secondary">Built-in</Badge>}
          <span className="text-muted-foreground">
            {group.member_count}{" "}
            {group.member_count === 1 ? "member" : "members"} ·{" "}
            {summary(group.models, "models")} · {summary(group.tools, "tools")}
          </span>
        </span>
        {!group.built_in && !renaming && (
          <span className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setRenaming(true)}
            >
              Rename
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              aria-label={`Delete ${group.name}`}
              disabled={remove.isPending}
              onClick={async () => {
                if (await confirm())
                  remove.mutate({ path: { group_id: group.id } });
              }}
            >
              Delete
            </Button>
          </span>
        )}
      </div>
      {renaming && <RenameForm group={group} done={() => setRenaming(false)} />}
      {remove.error && (
        <p role="alert" className="text-destructive">
          {errorDetail(remove.error, "Could not delete the group.")}
        </p>
      )}
      {options && (
        <Collapsible>
          <CollapsibleTrigger asChild>
            <Button type="button" variant="ghost" size="sm" className="w-fit">
              Edit access for {group.name}
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <AccessEditor key={group.id} group={group} options={options} />
          </CollapsibleContent>
        </Collapsible>
      )}
    </li>
  );
}

function CreateGroup() {
  const [name, setName] = useState("");
  const create = useMutation({
    ...groupCreateMutation({ client }),
    onSuccess: () => setName(""),
  });
  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        create.mutate({ body: { name: name.trim() } });
      }}
    >
      <div className="grid gap-1">
        <Label htmlFor="new-group-name">New group</Label>
        <Input
          id="new-group-name"
          className="w-60"
          maxLength={MAX_NAME}
          placeholder="For example, Night school"
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
      </div>
      <Button type="submit" disabled={!name.trim() || create.isPending}>
        Create group
      </Button>
      {create.error && (
        <p role="alert" className="text-destructive w-full text-sm">
          {errorDetail(create.error, "Could not create the group.")}
        </p>
      )}
    </form>
  );
}

/** Groups and what each may use (US-70.3, ADR-0058). Membership is set in Users. */
export const GroupSettings = () => {
  const groups = useQuery({
    ...groupGetManyOptions({ client }),
    retry: false,
  });
  const options = useQuery({
    ...groupAccessOptionsOptions({ client }),
    retry: false,
  });
  return (
    <div className="grid max-w-2xl gap-4">
      <div className="flex items-start gap-1">
        <p className="text-sm">
          Everyone is in one group. New users join Student, administrators are
          in Admin, and approving educator access moves someone to Educator.
          Each group can be limited to some models and tools. Move people
          between groups in Users.
        </p>
        <HelpTopic id="concept.group" />
      </div>
      <CreateGroup />
      {groups.isPending && <ListSkeleton label="Loading groups" rows={3} />}
      {groups.error && (
        <QueryError
          error={groups.error}
          message="Could not load groups."
          retry={groups.refetch}
          isRetrying={groups.isFetching}
        />
      )}
      {options.error && (
        <QueryError
          error={options.error}
          message="Could not load models and tools, so access can't be edited."
          retry={options.refetch}
          isRetrying={options.isFetching}
        />
      )}
      {groups.data && (
        <ul className="grid gap-2">
          {groups.data.map((group) => (
            <GroupRow key={group.id} group={group} options={options.data} />
          ))}
        </ul>
      )}
    </div>
  );
};
