"use client";

import { Required } from "@/components/required";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { TemplateDocument } from "@/lib/client";
import { cn } from "@/lib/utils";
import { PlusIcon, XIcon } from "lucide-react";
import { useId, useState } from "react";
import {
  assemble,
  assembleSegments,
  initialValues,
  missingRequired,
  type FieldValue,
  type FieldValues,
  type TemplateField,
} from "../lib/assemble";

const NONE = "__none__";
const MAX_EXAMPLES = 10;

type Props = {
  template: TemplateDocument;
  /**
   * Receives the assembled prompt; the caller decides where it goes. Without
   * it the builder is a try-out preview with no primary action.
   */
  onUse?: (prompt: string) => void;
  /** Rendered before the primary action, e.g. a Back button. */
  secondaryAction?: React.ReactNode;
};

/**
 * Schema-driven form beside a live preview. Hovering or focusing a field
 * highlights the preview text it produces, and hovering preview text highlights
 * its field.
 */
export function TemplateBuilder({ template, onUse, secondaryAction }: Props) {
  const idPrefix = useId();
  const [values, setValues] = useState<FieldValues>(() =>
    initialValues(template),
  );
  const [active, setActive] = useState<string | null>(null);
  const [showErrors, setShowErrors] = useState(false);
  const missing = new Set(missingRequired(template, values));
  const fieldId = (key: string) => `${idPrefix}-field-${key}`;
  const setValue = (key: string, value: FieldValue) =>
    setValues((current) => ({ ...current, [key]: value }));

  const use = () => {
    const first = template.fields.find((field) => missing.has(field.key));
    if (first) {
      setShowErrors(true);
      document
        .getElementById(
          fieldId(first.key) + (first.kind === "examples" ? "-0" : ""),
        )
        ?.focus();
      return;
    }
    onUse?.(assemble(template, values));
  };

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="grid min-w-0 gap-4 md:grid-cols-2">
        <div
          role="group"
          aria-label={`${template.name} fields`}
          className="min-w-0"
        >
          <FieldGroup className="gap-4">
            {template.fields.map((field) => (
              <TemplateFieldControl
                key={field.key}
                field={field}
                id={fieldId(field.key)}
                value={values[field.key]}
                onChange={(value) => setValue(field.key, value)}
                active={active === field.key}
                invalid={showErrors && missing.has(field.key)}
                onActivate={(on) =>
                  setActive((current) =>
                    on ? field.key : current === field.key ? null : current,
                  )
                }
              />
            ))}
          </FieldGroup>
        </div>
        <section
          aria-labelledby={`${idPrefix}-preview`}
          className="flex min-w-0 flex-col gap-2 md:sticky md:top-0 md:self-start"
        >
          <h3
            id={`${idPrefix}-preview`}
            className="text-muted-foreground text-xs font-medium"
          >
            Prompt preview
          </h3>
          <div
            data-testid="template-preview"
            className="bg-muted/60 rounded-surface border p-3 font-mono text-xs/relaxed [overflow-wrap:anywhere] whitespace-pre-wrap"
          >
            {assembleSegments(template, values).map((segment, index) =>
              segment.type === "text" ? (
                <span key={index}>{segment.text}</span>
              ) : (
                <span
                  key={index}
                  data-field={segment.key}
                  data-active={active === segment.key || undefined}
                  onMouseEnter={() => setActive(segment.key)}
                  onMouseLeave={() =>
                    setActive((current) =>
                      current === segment.key ? null : current,
                    )
                  }
                  className={cn(
                    "rounded-chip border-b border-dashed border-current/40 transition-colors",
                    "data-active:bg-primary/20 data-active:border-primary data-active:text-foreground",
                    !segment.text && "text-muted-foreground italic",
                  )}
                >
                  {segment.text || `[${segment.label}]`}
                </span>
              ),
            )}
          </div>
        </section>
      </div>
      <div className="flex flex-wrap items-center justify-end gap-2">
        {showErrors && missing.size > 0 && (
          <p role="alert" className="text-destructive mr-auto text-xs">
            Fill in the required fields first.
          </p>
        )}
        {secondaryAction}
        {onUse && (
          <Button type="button" onClick={use}>
            Use prompt
          </Button>
        )}
      </div>
    </div>
  );
}

function TemplateFieldControl({
  field,
  id,
  value,
  onChange,
  active,
  invalid,
  onActivate,
}: {
  field: TemplateField;
  id: string;
  value: FieldValue | undefined;
  onChange: (value: FieldValue) => void;
  active: boolean;
  invalid: boolean;
  onActivate: (active: boolean) => void;
}) {
  const helpId = `${id}-help`;
  const errorId = `${id}-error`;
  const describedBy =
    [field.help ? helpId : "", invalid ? errorId : ""]
      .filter(Boolean)
      .join(" ") || undefined;
  const text = typeof value === "string" ? value : "";
  const label = field.required ? (
    <Required>{field.label}</Required>
  ) : (
    field.label
  );
  const shared = {
    "aria-invalid": invalid || undefined,
    "aria-describedby": describedBy,
    "aria-required": field.required || undefined,
  };
  return (
    <Field
      data-field={field.key}
      data-active={active || undefined}
      data-invalid={invalid || undefined}
      className="rounded-surface data-active:ring-primary/50 data-active:bg-primary/5 -m-1.5 p-1.5 transition-colors data-active:ring-2"
      onMouseEnter={() => onActivate(true)}
      onMouseLeave={(event) => {
        if (!event.currentTarget.contains(document.activeElement))
          onActivate(false);
      }}
      onFocus={() => onActivate(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null))
          onActivate(false);
      }}
    >
      {field.kind === "examples" ? (
        <ExamplesControl
          id={id}
          label={label}
          labelText={field.label}
          values={Array.isArray(value) ? value : []}
          onChange={onChange}
          shared={shared}
        />
      ) : (
        <>
          <FieldLabel htmlFor={id}>{label}</FieldLabel>
          {field.kind === "short_text" && (
            <Input
              id={id}
              value={text}
              maxLength={500}
              onChange={(event) => onChange(event.target.value)}
              {...shared}
            />
          )}
          {field.kind === "long_text" && (
            <Textarea
              id={id}
              value={text}
              maxLength={8000}
              className="min-h-20"
              onChange={(event) => onChange(event.target.value)}
              {...shared}
            />
          )}
          {field.kind === "select" && (
            <Select
              value={text || NONE}
              onValueChange={(next) => onChange(next === NONE ? "" : next)}
            >
              <SelectTrigger id={id} className="w-full" {...shared}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(!field.required || !text) && (
                  <SelectItem value={NONE}>
                    {field.required ? "Choose…" : "None"}
                  </SelectItem>
                )}
                {field.options.map((option) => (
                  <SelectItem key={option} value={option}>
                    {option}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </>
      )}
      {field.help && (
        <FieldDescription id={helpId}>{field.help}</FieldDescription>
      )}
      {invalid && (
        <FieldError id={errorId}>{field.label} is required.</FieldError>
      )}
    </Field>
  );
}

function ExamplesControl({
  id,
  label,
  labelText,
  values,
  onChange,
  shared,
}: {
  id: string;
  label: React.ReactNode;
  labelText: string;
  values: string[];
  onChange: (value: string[]) => void;
  shared: Record<string, unknown>;
}) {
  const items = values.length ? values : [""];
  return (
    <fieldset className="flex min-w-0 flex-col gap-2">
      <legend className="mb-2 text-xs/relaxed font-medium">{label}</legend>
      {items.map((item, index) => (
        <div key={index} className="flex min-w-0 items-start gap-1">
          <Textarea
            id={`${id}-${index}`}
            aria-label={`${labelText} ${index + 1}`}
            value={item}
            maxLength={4000}
            className="min-h-16"
            onChange={(event) =>
              onChange(
                items.map((current, i) =>
                  i === index ? event.target.value : current,
                ),
              )
            }
            {...shared}
          />
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={`Remove ${labelText.toLowerCase()} ${index + 1}`}
            disabled={items.length === 1 && !item}
            onClick={() => onChange(items.filter((_, i) => i !== index))}
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
        disabled={items.length >= MAX_EXAMPLES}
        onClick={() => onChange([...items, ""])}
      >
        <PlusIcon />
        Add example
      </Button>
    </fieldset>
  );
}
