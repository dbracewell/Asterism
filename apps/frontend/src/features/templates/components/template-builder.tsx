"use client";

import { Required } from "@/components/required";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import type { TemplateDocument } from "@/lib/client";
import { cn } from "@/lib/utils";
import { ChevronDownIcon, PlusIcon, XIcon } from "lucide-react";
import { useId, useState } from "react";
import {
  assemble,
  assembleSegments,
  initialValues,
  isFilled,
  missingRequired,
  type FieldValue,
  type FieldValues,
  type TemplateField,
} from "../lib/assemble";
import {
  checklistFor,
  LEVELS,
  visibleFields,
  type ScaffoldingLevel,
} from "../lib/levels";

const NONE = "__none__";
const MAX_EXAMPLES = 10;

type Props = {
  template: TemplateDocument;
  /**
   * Receives the prompt and the level it was built at; the caller decides
   * where it goes. Without it the builder is a try-out preview with no
   * primary action.
   */
  onUse?: (prompt: string, level: ScaffoldingLevel) => void;
  /** Rendered before the primary action, e.g. a Back button. */
  secondaryAction?: React.ReactNode;
  initialLevel?: ScaffoldingLevel;
};

/**
 * A template at the scaffolding level the user picks. Guided and standard show
 * a schema-driven form beside a live preview: hovering or focusing a field
 * highlights the preview text it produces, and hovering preview text
 * highlights its field. Freeform shows a checklist beside a blank prompt.
 */
export function TemplateBuilder({
  template,
  onUse,
  secondaryAction,
  initialLevel = "guided",
}: Props) {
  const idPrefix = useId();
  const [level, setLevel] = useState<ScaffoldingLevel>(initialLevel);
  const [values, setValues] = useState<FieldValues>(() =>
    initialValues(template, initialLevel === "guided"),
  );
  const [freeform, setFreeform] = useState("");
  const [active, setActive] = useState<string | null>(null);
  const [showErrors, setShowErrors] = useState(false);
  const missing = new Set(missingRequired(template, values));
  const freeformMissing = !freeform.trim();
  const fieldId = (key: string) => `${idPrefix}-field-${key}`;
  const freeformId = `${idPrefix}-freeform`;
  const setValue = (key: string, value: FieldValue) =>
    setValues((current) => ({ ...current, [key]: value }));

  const changeLevel = (next: string) => {
    const chosen = LEVELS.find((option) => option.value === next)?.value;
    if (!chosen) return;
    setLevel(chosen);
    setShowErrors(false);
    // What the user typed is kept; guided fills only fields still empty.
    if (chosen === "guided") {
      const defaults = initialValues(template);
      setValues((current) =>
        Object.fromEntries(
          template.fields.map((field) => [
            field.key,
            isFilled(field, current[field.key])
              ? current[field.key]
              : defaults[field.key],
          ]),
        ),
      );
    }
  };

  const use = () => {
    if (level === "freeform") {
      if (freeformMissing) {
        setShowErrors(true);
        document.getElementById(freeformId)?.focus();
        return;
      }
      onUse?.(freeform, level);
      return;
    }
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
    onUse?.(assemble(template, values), level);
  };

  const control = (field: TemplateField) => (
    <TemplateFieldControl
      key={field.key}
      field={field}
      id={fieldId(field.key)}
      value={values[field.key]}
      onChange={(value) => setValue(field.key, value)}
      showExample={level === "guided"}
      active={active === field.key}
      invalid={showErrors && missing.has(field.key)}
      onActivate={(on) =>
        setActive((current) =>
          on ? field.key : current === field.key ? null : current,
        )
      }
    />
  );

  const structured = (
    <StructuredLevel
      template={template}
      level={level}
      idPrefix={idPrefix}
      values={values}
      active={active}
      setActive={setActive}
      control={control}
    />
  );
  const description = LEVELS.find((option) => option.value === level)!;
  const invalid =
    showErrors && (level === "freeform" ? freeformMissing : missing.size > 0);

  return (
    <Tabs value={level} onValueChange={changeLevel} className="min-w-0 gap-4">
      <div className="flex min-w-0 flex-col gap-1">
        <TabsList aria-label="Scaffolding level">
          {LEVELS.map((option) => (
            <TabsTrigger key={option.value} value={option.value}>
              {option.label}
            </TabsTrigger>
          ))}
        </TabsList>
        <p className="text-muted-foreground text-xs">
          {description.description}
        </p>
      </div>
      <TabsContent value="guided">
        {level === "guided" && structured}
      </TabsContent>
      <TabsContent value="standard">
        {level === "standard" && structured}
      </TabsContent>
      <TabsContent value="freeform">
        <FreeformLevel
          template={template}
          id={freeformId}
          value={freeform}
          onChange={setFreeform}
          invalid={showErrors && freeformMissing}
        />
      </TabsContent>
      <div className="flex flex-wrap items-center justify-end gap-2">
        {invalid && (
          <p role="alert" className="text-destructive mr-auto text-xs">
            {level === "freeform"
              ? "Write your prompt first."
              : "Fill in the required fields first."}
          </p>
        )}
        {secondaryAction}
        {onUse && (
          <Button type="button" onClick={use}>
            Use prompt
          </Button>
        )}
      </div>
    </Tabs>
  );
}

function StructuredLevel({
  template,
  level,
  idPrefix,
  values,
  active,
  setActive,
  control,
}: {
  template: TemplateDocument;
  level: ScaffoldingLevel;
  idPrefix: string;
  values: FieldValues;
  active: string | null;
  setActive: React.Dispatch<React.SetStateAction<string | null>>;
  control: (field: TemplateField) => React.ReactNode;
}) {
  const { primary, more } = visibleFields(template, level);
  const [moreOpen, setMoreOpen] = useState(false);
  return (
    <div className="grid min-w-0 gap-4 md:grid-cols-2">
      <div
        role="group"
        aria-label={`${template.name} fields`}
        className="flex min-w-0 flex-col gap-4"
      >
        <FieldGroup className="gap-4">{primary.map(control)}</FieldGroup>
        {more.length > 0 && (
          <Collapsible open={moreOpen} onOpenChange={setMoreOpen}>
            <CollapsibleTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="-ml-2 self-start"
              >
                <ChevronDownIcon
                  className={cn(
                    "transition-transform",
                    moreOpen && "rotate-180",
                  )}
                />
                More ({more.length} optional)
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="pt-2">
              <FieldGroup className="gap-4">{more.map(control)}</FieldGroup>
            </CollapsibleContent>
          </Collapsible>
        )}
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
  );
}

/** A blank prompt beside a self-check list; ticks are not saved or sent. */
function FreeformLevel({
  template,
  id,
  value,
  onChange,
  invalid,
}: {
  template: TemplateDocument;
  id: string;
  value: string;
  onChange: (value: string) => void;
  invalid: boolean;
}) {
  const checklist = checklistFor(template);
  const [checked, setChecked] = useState<Set<number>>(() => new Set());
  const errorId = `${id}-error`;
  return (
    <div className="grid min-w-0 gap-4 md:grid-cols-2">
      <section
        aria-labelledby={`${id}-checklist`}
        className="flex min-w-0 flex-col gap-2"
      >
        <h3
          id={`${id}-checklist`}
          className="text-muted-foreground text-xs font-medium"
        >
          A good prompt covers
        </h3>
        <ul data-testid="template-checklist" className="flex flex-col gap-2">
          {checklist.map((item, index) => (
            <li key={index} className="flex items-start gap-2">
              <Checkbox
                id={`${id}-check-${index}`}
                className="mt-0.5"
                checked={checked.has(index)}
                onCheckedChange={(next) =>
                  setChecked((current) => {
                    const updated = new Set(current);
                    if (next === true) updated.add(index);
                    else updated.delete(index);
                    return updated;
                  })
                }
              />
              <label
                htmlFor={`${id}-check-${index}`}
                className="text-xs/relaxed"
              >
                {item}
              </label>
            </li>
          ))}
        </ul>
      </section>
      <Field data-invalid={invalid || undefined} className="min-w-0">
        <FieldLabel htmlFor={id}>
          <Required>Your prompt</Required>
        </FieldLabel>
        <Textarea
          id={id}
          value={value}
          maxLength={16000}
          className="min-h-40"
          aria-required
          aria-invalid={invalid || undefined}
          aria-describedby={invalid ? errorId : undefined}
          onChange={(event) => onChange(event.target.value)}
        />
        {invalid && (
          <FieldError id={errorId}>Your prompt is required.</FieldError>
        )}
      </Field>
    </div>
  );
}

function TemplateFieldControl({
  field,
  id,
  value,
  onChange,
  showExample,
  active,
  invalid,
  onActivate,
}: {
  field: TemplateField;
  id: string;
  value: FieldValue | undefined;
  onChange: (value: FieldValue) => void;
  showExample: boolean;
  active: boolean;
  invalid: boolean;
  onActivate: (active: boolean) => void;
}) {
  const helpId = `${id}-help`;
  const exampleId = `${id}-example`;
  const errorId = `${id}-error`;
  const example = showExample ? field.example : null;
  const describedBy =
    [field.help ? helpId : "", example ? exampleId : "", invalid ? errorId : ""]
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
      {example && (
        <FieldDescription id={exampleId} data-example>
          Example: {example}
        </FieldDescription>
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
