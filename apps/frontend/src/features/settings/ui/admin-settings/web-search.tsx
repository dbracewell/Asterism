/* eslint-disable @typescript-eslint/no-explicit-any */
import { Button } from "@/components/ui/button";
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
import { ComponentResponse } from "@/lib/client";
import {
  appSettingsBulkUpdateMutation,
  componentsByTypeOptions,
} from "@/lib/client/@tanstack/react-query.gen";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery } from "@tanstack/react-query";
import { LoaderCircleIcon, SaveIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";
import z from "zod";

export const WebSearchSettings = () => {
  const [provider, setProvider] = useState<ComponentResponse | null>(null);
  const { data, isLoading } = useQuery({
    ...componentsByTypeOptions({
      client: client,
      path: {
        component_type: "WebSearch",
      },
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
    <div className="flex h-full flex-1 flex-col">
      <div className="flex items-center gap-2 border-b pb-2">
        <h1 className="text-base font-bold">Web Search Provider</h1>
      </div>
      <div className="flex flex-1 flex-col gap-2 overflow-y-auto py-2 pt-4">
        <Label>Select Your Provider</Label>
        <Select
          onValueChange={(e) => {
            const provider = data?.items.find((p) => p.name === e);
            if (provider) {
              setProvider(provider);
            }
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
            <h4 className="mt-3 text-sm font-medium">Parameters</h4>
            <div className="bg-card flex flex-1 flex-col gap-1 rounded border p-2">
              <ParameterForm zSchema={zSchema} provider={provider} />
            </div>
          </>
        )}
      </div>
    </div>
  );
};

const ParameterForm = ({
  provider,
  zSchema,
}: {
  provider: ComponentResponse;
  zSchema: z.ZodType<unknown, any, z.core.$ZodTypeInternals<any, any>>;
}) => {
  const router = useRouter();
  const form = useForm<z.infer<typeof zSchema>>({
    resolver: zodResolver(zSchema),
    defaultValues: Object.fromEntries(
      Object.entries(
        provider.parameters["properties"] as Record<string, any>,
      ).map(([name]) => [name, ""]),
    ),
  });
  const { control, handleSubmit } = form;

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
          websearch_provider: {
            name: provider.name,
            parameters: values,
          },
        },
      },
    });
  };

  return (
    <form
      className="flex flex-1 flex-col gap-2"
      onSubmit={handleSubmit(onSubmit)}
    >
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
