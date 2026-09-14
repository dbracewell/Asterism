/* eslint-disable @typescript-eslint/no-explicit-any */
import { HelpIcon } from "@/components/help-icon";
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { client } from "@/lib/api";
import {
  ComponentProviderParameters,
  ComponentResponse,
  ComponentType,
} from "@/lib/client";
import { componentsByTypeOptions } from "@/lib/client/@tanstack/react-query.gen";
import { cn } from "@/lib/utils";
import { zodResolver } from "@hookform/resolvers/zod";
import { useQuery } from "@tanstack/react-query";
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
};

export const ComponentSettings = ({
  defaultValue,
  component_type,
  settings_key,
  className,
  onUpdate,
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
  const [provider, setProvider] = useState<ComponentResponse | null>(null);

  useEffect(() => {
    if (data) {
      if (providerName) {
        setProvider(data.items.find((m) => m.name === providerName) ?? null);
      } else {
        setProvider(null);
      }
    }
  }, [providerName, setProvider, data]);

  const zSchema = useMemo(() => {
    if (provider) {
      return z.fromJSONSchema(provider.parameters);
    }
    return null;
  }, [provider]);

  if (isLoading) {
    return <Spinner />;
  }

  return (
    <div className={cn("flex flex-col", className)}>
      <div className={cn("flex flex-1 flex-col gap-2 overflow-y-auto")}>
        <Label>Select Your Provider</Label>
        <Select value={providerName} onValueChange={setProviderName}>
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
  const form = useForm<z.infer<typeof zSchema>>({
    resolver: zodResolver(zSchema),
    defaultValues: Object.fromEntries(
      Object.entries(
        provider.parameters["properties"] as Record<string, any>,
      ).map(([name, value]) => [
        name,
        appProvider?.parameters?.[name] ?? value["default"] ?? "",
      ]),
    ),
  });

  const { control, handleSubmit } = form;
  useEffect(() => {
    form.reset(
      Object.fromEntries(
        Object.entries(
          provider.parameters["properties"] as Record<string, any>,
        ).map(([name, value]) => [
          name,
          appProvider?.parameters?.[name] ?? value["default"] ?? "",
        ]),
      ),
    );
  }, [appProvider, form, provider]);

  const processChange = () => {
    const values = zSchema.safeParse(form.getValues());
    if (values.success) {
      onUpdate({ name: provider.name, parameters: values.data });
    }
  };

  return (
    <form id={`form-${settings_key}`} className="flex flex-1 flex-col gap-2">
      {form.formState.isDirty && (
        <h5 className="text-muted-foreground text-xs">* Updated</h5>
      )}
      <FieldGroup className="flex flex-1 flex-col gap-2">
        {provider &&
          Object.entries(
            provider.parameters["properties"] as Record<string, any>,
          ).map(([name, info]) => (
            <Controller
              key={name}
              control={control}
              name={name}
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <FieldLabel htmlFor={name}>
                    {info["title"]}
                    {!!info["description"] && (
                      <HelpIcon text={info["description"]} />
                    )}
                  </FieldLabel>
                  {info["enum"] ? (
                    <Select
                      value={field.value}
                      onValueChange={(e) => {
                        field.onChange(e);
                        processChange();
                      }}
                    >
                      <SelectTrigger>
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
                  ) : (
                    <Input
                      {...field}
                      onChange={(e) => {
                        field.onChange(e);
                        processChange();
                      }}
                      id={name}
                      aria-invalid={fieldState.invalid}
                      required
                    />
                  )}
                  {fieldState.invalid && (
                    <FieldError errors={[fieldState.error]} />
                  )}
                </Field>
              )}
            />
          ))}
      </FieldGroup>
    </form>
  );
};
