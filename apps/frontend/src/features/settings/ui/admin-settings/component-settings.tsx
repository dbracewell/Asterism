/* eslint-disable @typescript-eslint/no-explicit-any */
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import { ComponentProviderParameters, ComponentResponse } from "@/lib/client";
import {
  appSettingDeleteMutation,
  appSettingsBulkUpdateMutation,
  componentsByTypeOptions,
} from "@/lib/client/@tanstack/react-query.gen";
import { cn } from "@/lib/utils";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery } from "@tanstack/react-query";
import { LoaderCircleIcon, SaveIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";
import z from "zod";

type ComponentSettingsProps = {
  defaultValue?: ComponentProviderParameters | null;
  component_type: string;
  settings_key: string;
  title: string;
};

export const ComponentSettings = ({
  defaultValue,
  component_type,
  settings_key,
  title,
}: ComponentSettingsProps) => {
  const { data, isLoading } = useQuery({
    ...componentsByTypeOptions({
      client: client,
      path: {
        component_type,
      },
    }),
  });

  const [isActive, setIsActive] = useState(defaultValue != null);
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

  const deleteSetting = useMutation({
    ...appSettingDeleteMutation({
      client: client,
    }),
  });

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
    <div className="flex flex-col">
      <h3 className="bg-accent text-accent-foreground flex items-center gap-2 rounded-t border border-b-0 p-2 text-sm font-bold">
        <Checkbox
          checked={isActive}
          onCheckedChange={(e) => {
            if (!e) {
              deleteSetting.mutate({
                path: {
                  key: settings_key,
                },
              });
            }
            setIsActive((prev) => !prev);
          }}
        />
        {title}
      </h3>
      <div
        className={cn(
          "flex flex-1 flex-col gap-2 overflow-y-auto rounded-b border p-2 py-2 pt-4",
          !isActive && "hidden",
        )}
      >
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
            <h4 className="mt-3 text-sm font-medium">Parameters</h4>
            <div className="flex flex-1 flex-col gap-1">
              <ParameterForm
                zSchema={zSchema}
                provider={provider}
                appProvider={defaultValue}
                settings_key={settings_key}
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
}: {
  provider: ComponentResponse;
  appProvider?: ComponentProvider | null;
  zSchema: z.ZodType<unknown, any, z.core.$ZodTypeInternals<any, any>>;
  settings_key: string;
}) => {
  const router = useRouter();
  const form = useForm<z.infer<typeof zSchema>>({
    resolver: zodResolver(zSchema),
    defaultValues:
      provider.name === appProvider?.name
        ? { ...appProvider.parameters }
        : Object.fromEntries(
            Object.entries(
              provider.parameters["properties"] as Record<string, any>,
            ).map(([name]) => [name, ""]),
          ),
  });
  const { control, handleSubmit } = form;

  useEffect(() => {
    form.reset(
      provider.name === appProvider?.name
        ? { ...appProvider.parameters }
        : Object.fromEntries(
            Object.entries(
              provider.parameters["properties"] as Record<string, any>,
            ).map(([name]) => [name, ""]),
          ),
    );
  }, [appProvider, form, provider]);

  const saveProviders = useMutation({
    ...appSettingsBulkUpdateMutation({
      client,
    }),
    onSuccess: () => {
      toast.success("Settings saved");
      router.refresh();
    },
    onError: () => toast.error("Failed to save. Please try again."),
  });

  const onSubmit = (values: z.infer<typeof zSchema>) => {
    saveProviders.mutate({
      body: {
        values: {
          [settings_key]: {
            name: provider.name,
            parameters: values,
          },
        },
      },
    });
  };

  return (
    <form
      id={`form-${settings_key}`}
      className="flex flex-1 flex-col gap-2"
      onSubmit={handleSubmit(onSubmit)}
    >
      {form.formState.isDirty && (
        <h5 className="text-muted-foreground text-xs">* Updated</h5>
      )}
      <FieldGroup className="flex flex-1 flex-col gap-1">
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
                  <FieldLabel htmlFor={name}>{info["title"]}</FieldLabel>
                  <Input
                    {...field}
                    id={name}
                    aria-invalid={fieldState.invalid}
                    required
                  />
                  {fieldState.invalid && (
                    <FieldError errors={[fieldState.error]} />
                  )}
                </Field>
              )}
            />
          ))}
      </FieldGroup>
      <div className="flex items-center justify-end gap-2">
        <Button type="submit" disabled={saveProviders.isPending}>
          {saveProviders.isPending ? (
            <LoaderCircleIcon className="animate-spin" />
          ) : (
            <SaveIcon />
          )}
          Save
        </Button>
      </div>
    </form>
  );
};
