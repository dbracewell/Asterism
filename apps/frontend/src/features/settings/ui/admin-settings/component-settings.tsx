/* eslint-disable @typescript-eslint/no-explicit-any */
import { FormSkeleton } from "@/components/loading-skeletons";
import { HelpIcon } from "@/components/help-icon";
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { client } from "@/lib/api";
import {
  ComponentProviderParameters,
  ComponentResponse,
  ComponentType,
} from "@/lib/client";
import {
  componentsByTypeOptions,
  componentsTestMutation,
} from "@/lib/client/@tanstack/react-query.gen";
import { cn } from "@/lib/utils";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import z from "zod";

type ComponentSettingsProps = {
  defaultValue?: ComponentProviderParameters | null;
  component_type: ComponentType;
  settings_key: string;
  className?: string;
  onUpdate: ({
    name,
    parameters,
  }: {
    name: string;
    parameters: ComponentProviderParameters;
  }) => void;
  /** Called when another provider is picked, before any of its parameters change. */
  onProviderChange?: (name: string) => void;
};

export const ComponentSettings = ({
  defaultValue,
  component_type,
  settings_key,
  className,
  onUpdate,
  onProviderChange,
}: ComponentSettingsProps) => {
  const { data, isLoading } = useQuery({
    ...componentsByTypeOptions({
      client: client,
      path: {
        component_type,
      },
    }),
  });

  const [providerName, setProviderName] = useState(defaultValue?.name ?? "");
  const provider = useMemo(
    () =>
      (providerName && data?.items.find((m) => m.name === providerName)) ||
      null,
    [data, providerName],
  );

  const zSchema = useMemo(() => {
    if (provider) {
      return z.fromJSONSchema(provider.parameters);
    }
    return null;
  }, [provider]);

  if (isLoading) {
    return <FormSkeleton label="Loading settings…" fields={2} />;
  }

  return (
    <div className={cn("flex flex-col", className)}>
      <div className={cn("flex flex-1 flex-col gap-2 overflow-y-auto")}>
        <Label>Select your provider</Label>
        <Select
          value={providerName}
          onValueChange={(name) => {
            setProviderName(name);
            onProviderChange?.(name);
          }}
        >
          <SelectTrigger className="max-w-100 min-w-40 truncate">
            <SelectValue placeholder="Select a provider" />
          </SelectTrigger>
          <SelectContent align="start">
            {data?.items.map((provider) => (
              <SelectItem key={provider.name} value={provider.name}>
                {provider.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {zSchema && provider && (
          <>
            <div className="flex flex-1 flex-col gap-1 pt-2">
              <ParameterForm
                zSchema={zSchema}
                provider={provider}
                appProvider={defaultValue}
                settings_key={settings_key}
                onUpdate={onUpdate}
              />
            </div>
          </>
        )}
      </div>
    </div>
  );
};

type ParameterKind = "enum" | "boolean" | "number" | "json" | "secret" | "text";

const SECRET_NAME =
  /^(api_key|secret|token|password)$|_(api_key|secret|token|password)$/i;

/** The JSON-schema type of a property, looking through `X | None` (anyOf with null). */
function schemaType(info: any): string | undefined {
  if (info["type"]) return info["type"];
  const options = (info["anyOf"] ?? []) as any[];
  return options.find(
    (option) => option["type"] && option["type"] !== "null",
  )?.["type"];
}

export function parameterKind(name: string, info: any): ParameterKind {
  if (info["enum"]) return "enum";
  const type = schemaType(info);
  if (type === "boolean") return "boolean";
  if (type === "integer" || type === "number") return "number";
  if (type === "object" || type === "array") return "json";
  return SECRET_NAME.test(name) ? "secret" : "text";
}

function initialValue(name: string, info: any, stored: unknown) {
  if (stored !== undefined && stored !== null) return stored;
  if (info["default"] !== undefined) return info["default"];
  const kind = parameterKind(name, info);
  if (kind === "boolean") return false;
  if (kind === "json") return null;
  return "";
}

const JsonField = ({
  id,
  value,
  example,
  invalid,
  onChange,
}: {
  id: string;
  value: unknown;
  example?: unknown;
  invalid: boolean;
  onChange: (value: unknown) => void;
}) => {
  const [text, setText] = useState(() =>
    value == null ? "" : JSON.stringify(value, null, 2),
  );
  const [error, setError] = useState<string | null>(null);

  const update = (next: string) => {
    setText(next);
    if (!next.trim()) {
      setError(null);
      onChange(null);
      return;
    }
    try {
      const parsed = JSON.parse(next);
      setError(null);
      onChange(parsed);
    } catch {
      setError("This isn't valid JSON yet.");
    }
  };

  return (
    <div className="flex flex-col gap-1">
      <Textarea
        id={id}
        value={text}
        onChange={(event) => update(event.target.value)}
        aria-invalid={invalid || !!error}
        className="min-h-32 font-mono text-xs"
        spellCheck={false}
      />
      <div className="flex items-center gap-2">
        {example !== undefined && (
          <Button
            type="button"
            variant="outline"
            size="xs"
            onClick={() => update(JSON.stringify(example, null, 2))}
          >
            Use the example
          </Button>
        )}
        {error && <span className="text-destructive text-xs">{error}</span>}
      </div>
    </div>
  );
};

const ParameterForm = ({
  provider,
  appProvider,
  zSchema,
  settings_key,
  onUpdate,
}: {
  provider: ComponentResponse;
  appProvider?: ComponentProviderParameters | null;
  zSchema: z.ZodType<unknown, any, z.core.$ZodTypeInternals<any, any>>;
  settings_key: string;
  onUpdate: ({
    name,
    parameters,
  }: {
    name: string;
    parameters: ComponentProviderParameters;
  }) => void;
}) => {
  const properties = provider.parameters["properties"] as Record<string, any>;
  const required = new Set<string>(
    (provider.parameters["required"] as string[] | undefined) ?? [],
  );
  const defaults = () =>
    Object.fromEntries(
      Object.entries(properties).map(([name, info]) => [
        name,
        initialValue(name, info, appProvider?.parameters?.[name]),
      ]),
    );
  const form = useForm<z.infer<typeof zSchema>>({
    resolver: zodResolver(zSchema),
    defaultValues: defaults(),
  });

  const { control } = form;
  useEffect(() => {
    form.reset(defaults());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appProvider, form, provider]);

  // A test reads nothing back into the cache; refetching would reset the form.
  const test = useMutation({
    ...componentsTestMutation({ client }),
    meta: { skipGlobalInvalidation: true },
  });
  const suggestions = test.data?.suggestions ?? {};

  const processChange = () => {
    const values = zSchema.safeParse(form.getValues());
    if (values.success) {
      onUpdate({ name: provider.name, parameters: values.data as any });
    }
  };

  const runTest = () =>
    test.mutate({
      path: {
        component_type: provider.type as ComponentType,
        name: provider.name,
      },
      body: { parameters: form.getValues() as Record<string, unknown> },
    });

  return (
    <form id={`form-${settings_key}`} className="flex flex-1 flex-col gap-2">
      {form.formState.isDirty && (
        <h5 className="text-muted-foreground text-xs">* Updated</h5>
      )}
      <FieldGroup className="flex flex-1 flex-col gap-2">
        {Object.entries(properties).map(([name, info]) => {
          const kind = parameterKind(name, info);
          const title = info["title"] ?? name;
          return (
            <Controller
              key={name}
              control={control}
              name={name}
              render={({ field, fieldState }) => (
                <Field
                  data-invalid={fieldState.invalid}
                  orientation={kind === "boolean" ? "horizontal" : undefined}
                >
                  {kind === "boolean" && (
                    <Switch
                      id={name}
                      checked={!!field.value}
                      onCheckedChange={(checked) => {
                        field.onChange(checked);
                        processChange();
                      }}
                    />
                  )}
                  <div className="flex items-center gap-1">
                    <FieldLabel htmlFor={name}>{title}</FieldLabel>
                    {!!info["description"] && (
                      <HelpIcon
                        label={`About ${title}`}
                        text={info["description"]}
                      />
                    )}
                  </div>
                  {kind === "enum" && (
                    <Select
                      value={field.value as string}
                      onValueChange={(e) => {
                        field.onChange(e);
                        processChange();
                      }}
                    >
                      <SelectTrigger id={name}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {info["enum"].map((option: string) => (
                          <SelectItem key={option} value={option}>
                            {option}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                  {kind === "json" && (
                    <JsonField
                      id={name}
                      value={field.value}
                      example={info["examples"]?.[0]}
                      invalid={fieldState.invalid}
                      onChange={(value) => {
                        field.onChange(value);
                        processChange();
                      }}
                    />
                  )}
                  {(kind === "text" ||
                    kind === "secret" ||
                    kind === "number") && (
                    <Input
                      name={field.name}
                      ref={field.ref}
                      onBlur={field.onBlur}
                      value={(field.value as string | number | undefined) ?? ""}
                      type={
                        kind === "secret"
                          ? "password"
                          : kind === "number"
                            ? "number"
                            : "text"
                      }
                      step={
                        kind === "number"
                          ? schemaType(info) === "integer"
                            ? 1
                            : "any"
                          : undefined
                      }
                      onChange={(e) => {
                        const raw = e.target.value;
                        field.onChange(
                          kind === "number" && raw !== "" ? Number(raw) : raw,
                        );
                        processChange();
                      }}
                      id={name}
                      aria-invalid={fieldState.invalid}
                      required={required.has(name)}
                    />
                  )}
                  {!!suggestions[name]?.length && (
                    <div className="flex flex-wrap items-center gap-1">
                      <span className="text-muted-foreground text-xs">
                        Found:
                      </span>
                      {suggestions[name].map((option) => (
                        <Button
                          key={option}
                          type="button"
                          variant={
                            field.value === option ? "secondary" : "outline"
                          }
                          size="xs"
                          onClick={() => {
                            field.onChange(option);
                            processChange();
                          }}
                        >
                          {option}
                        </Button>
                      ))}
                    </div>
                  )}
                  {fieldState.invalid && (
                    <FieldError errors={[fieldState.error]} />
                  )}
                </Field>
              )}
            />
          );
        })}
      </FieldGroup>
      {provider.testable && (
        <div className="flex flex-col gap-2 pt-1">
          <div>
            <Button
              type="button"
              variant="outline"
              onClick={runTest}
              disabled={test.isPending}
            >
              {test.isPending ? "Testing…" : "Test connection"}
            </Button>
          </div>
          {test.data && (
            <Alert variant={test.data.ok ? "default" : "destructive"}>
              <AlertDescription>{test.data.detail}</AlertDescription>
            </Alert>
          )}
          {test.isError && (
            <Alert variant="destructive">
              <AlertDescription>The test couldn&apos;t run.</AlertDescription>
            </Alert>
          )}
        </div>
      )}
    </form>
  );
};
