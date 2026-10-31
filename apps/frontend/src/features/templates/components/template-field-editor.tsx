"use client";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  PlusIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";
import {
  changeKind,
  KIND_LABELS,
  LIMITS,
  parseOptions,
  type DraftField,
  type FieldKind,
} from "../lib/draft";

const NO_DEFAULT = "__none__";

type Props = {
  /** Prefix for element IDs; unique per field. */
  id: string;
  field: DraftField;
  index: number;
  count: number;
  disabled: boolean;
  issues: string[];
  onChange: (field: DraftField) => void;
  onMove: (offset: -1 | 1) => void;
  onRemove: () => void;
};

/** One field of the template schema: kind, key, label, help, example, required and default. */
export function TemplateFieldEditor({
  id,
  field,
  index,
  count,
  disabled,
  issues,
  onChange,
  onMove,
  onRemove,
}: Props) {
  const set = (patch: Partial<DraftField>) => onChange({ ...field, ...patch });
  const name = field.label.trim() || field.key || `field ${index + 1}`;
  const errorId = `${id}-issues`;
  const options = parseOptions(field.options);
  return (
    <fieldset
      aria-describedby={issues.length ? errorId : undefined}
      className="rounded-surface data-invalid:border-destructive/60 flex min-w-0 flex-col gap-3 border p-3"
      data-invalid={issues.length ? true : undefined}
      data-field-editor={field.key}
    >
      <legend className="sr-only">
        Field {index + 1}: {name}
      </legend>
      <div className="flex min-w-0 items-center gap-2">
        <p aria-hidden className="min-w-0 flex-1 font-medium wrap-anywhere">
          {index + 1}. {name}
        </p>
        <Button
          id={`${id}-move-up`}
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={`Move ${name} up`}
          disabled={disabled || index === 0}
          onClick={() => onMove(-1)}
        >
          <ArrowUpIcon />
        </Button>
        <Button
          id={`${id}-move-down`}
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={`Move ${name} down`}
          disabled={disabled || index === count - 1}
          onClick={() => onMove(1)}
        >
          <ArrowDownIcon />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={`Remove ${name}`}
          disabled={disabled || count === 1}
          onClick={onRemove}
        >
          <Trash2Icon />
        </Button>
      </div>
      <div className="grid min-w-0 gap-3 sm:grid-cols-2">
        <Field>
          <FieldLabel htmlFor={`${id}-label`}>Label</FieldLabel>
          <Input
            id={`${id}-label`}
            value={field.label}
            maxLength={LIMITS.label}
            disabled={disabled}
            onChange={(event) => set({ label: event.target.value })}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor={`${id}-key`}>Key</FieldLabel>
          <Input
            id={`${id}-key`}
            value={field.key}
            maxLength={32}
            className="font-mono"
            spellCheck={false}
            autoCapitalize="off"
            disabled={disabled}
            aria-describedby={`${id}-key-help`}
            onChange={(event) => set({ key: event.target.value })}
          />
          <FieldDescription id={`${id}-key-help`}>
            Used as {`{{${field.key || "key"}}}`} in the body.
          </FieldDescription>
        </Field>
        <Field>
          <FieldLabel htmlFor={`${id}-kind`}>Kind</FieldLabel>
          <Select
            value={field.kind}
            disabled={disabled}
            onValueChange={(kind) =>
              onChange(changeKind(field, kind as FieldKind))
            }
          >
            <SelectTrigger id={`${id}-kind`} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(KIND_LABELS).map(([kind, label]) => (
                <SelectItem key={kind} value={kind}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <div className="flex items-center gap-2 sm:pt-5">
          <Checkbox
            id={`${id}-required`}
            checked={field.required}
            disabled={disabled}
            onCheckedChange={(checked) => set({ required: checked === true })}
          />
          <Label htmlFor={`${id}-required`}>Required</Label>
        </div>
      </div>
      <Field>
        <FieldLabel htmlFor={`${id}-help`}>Help text</FieldLabel>
        <Input
          id={`${id}-help`}
          value={field.help}
          maxLength={LIMITS.help}
          disabled={disabled}
          onChange={(event) => set({ help: event.target.value })}
        />
      </Field>
      <Field>
        <FieldLabel htmlFor={`${id}-example`}>Example</FieldLabel>
        <Input
          id={`${id}-example`}
          value={field.example}
          maxLength={LIMITS.hint}
          disabled={disabled}
          aria-describedby={`${id}-example-help`}
          onChange={(event) => set({ example: event.target.value })}
        />
        <FieldDescription id={`${id}-example-help`}>
          Shown at the guided level only; never added to the prompt.
        </FieldDescription>
      </Field>
      {field.kind === "select" && (
        <Field>
          <FieldLabel htmlFor={`${id}-options`}>Options</FieldLabel>
          <Textarea
            id={`${id}-options`}
            value={field.options}
            className="min-h-20"
            disabled={disabled}
            aria-describedby={`${id}-options-help`}
            onChange={(event) => {
              const next = event.target.value;
              set({
                options: next,
                // Drop a default that no longer names an option.
                defaultText: parseOptions(next).includes(field.defaultText)
                  ? field.defaultText
                  : "",
              });
            }}
          />
          <FieldDescription id={`${id}-options-help`}>
            One option per line, up to {LIMITS.options}.
          </FieldDescription>
        </Field>
      )}
      <DefaultControl
        id={`${id}-default`}
        field={field}
        options={options}
        disabled={disabled}
        onChange={set}
      />
      {issues.length > 0 && (
        // The dialog's summary is the live alert; this text only describes the field.
        <ul
          id={errorId}
          className="text-destructive flex flex-col gap-1 text-xs"
        >
          {issues.map((issue) => (
            <li key={issue}>{issue}</li>
          ))}
        </ul>
      )}
    </fieldset>
  );
}

function DefaultControl({
  id,
  field,
  options,
  disabled,
  onChange,
}: {
  id: string;
  field: DraftField;
  options: string[];
  disabled: boolean;
  onChange: (patch: Partial<DraftField>) => void;
}) {
  if (field.kind === "examples") {
    const items = field.examples.length ? field.examples : [""];
    return (
      <fieldset className="flex min-w-0 flex-col gap-2">
        <legend className="mb-2 text-xs/relaxed font-medium">
          Default examples
        </legend>
        {items.map((item, index) => (
          <div key={index} className="flex min-w-0 items-start gap-1">
            <Textarea
              id={`${id}-${index}`}
              aria-label={`Default example ${index + 1}`}
              value={item}
              maxLength={LIMITS.example}
              className="min-h-16"
              disabled={disabled}
              onChange={(event) =>
                onChange({
                  examples: items.map((current, i) =>
                    i === index ? event.target.value : current,
                  ),
                })
              }
            />
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={`Remove default example ${index + 1}`}
              disabled={disabled || (items.length === 1 && !item)}
              onClick={() =>
                onChange({ examples: items.filter((_, i) => i !== index) })
              }
            >
              <XIcon />
            </Button>
          </div>
        ))}
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="self-start"
          disabled={disabled || items.length >= LIMITS.examples}
          onClick={() => onChange({ examples: [...items, ""] })}
        >
          <PlusIcon />
          Add default example
        </Button>
      </fieldset>
    );
  }
  if (field.kind === "select")
    return (
      <Field>
        <FieldLabel htmlFor={id}>Default</FieldLabel>
        <Select
          value={field.defaultText || NO_DEFAULT}
          disabled={disabled}
          onValueChange={(value) =>
            onChange({ defaultText: value === NO_DEFAULT ? "" : value })
          }
        >
          <SelectTrigger id={id} className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NO_DEFAULT}>No default</SelectItem>
            {[...new Set(options)].map((option) => (
              <SelectItem key={option} value={option}>
                {option}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
    );
  const long = field.kind === "long_text";
  const Control = long ? Textarea : Input;
  return (
    <Field>
      <FieldLabel htmlFor={id}>Default</FieldLabel>
      <Control
        id={id}
        value={field.defaultText}
        maxLength={long ? LIMITS.longText : LIMITS.shortText}
        className={long ? "min-h-16" : undefined}
        disabled={disabled}
        onChange={(event) => onChange({ defaultText: event.target.value })}
      />
    </Field>
  );
}
