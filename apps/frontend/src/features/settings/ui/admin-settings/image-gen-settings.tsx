"use client";

import { APIImage } from "@/components/api-image";
import { QueryError } from "@/components/query-error";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { useUser } from "@/features/auth/components/user-context";
import { ComponentSettings } from "@/features/settings/ui/admin-settings/component-settings";
import {
  LocalImageModels,
  errorText,
} from "@/features/settings/ui/admin-settings/local-image-models";
import {
  SettingsPane,
  SettingsSection,
} from "@/features/settings/ui/settings-section";
import { client } from "@/lib/api";
import type {
  ComponentProviderParameters,
  ImageGenerationPolicy,
} from "@/lib/client";
import {
  appSettingsGetOptions,
  appSettingsGetQueryKey,
  appSettingUpdateMutation,
  fileGetManyInfiniteQueryKey,
  fileGetManyQueryKey,
  groupGetManyOptions,
  imageGenerationAvailabilityQueryKey,
  imageGenerationPolicyGetOptions,
  imageGenerationPolicyGetQueryKey,
  imageGenerationPolicyUpdateMutation,
  imageGenerationProviderStatusOptions,
  imageGenerationProviderStatusQueryKey,
  imageGenerationTestMutation,
  localImageOverviewQueryKey,
} from "@/lib/client/@tanstack/react-query.gen";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

const SETTING_KEY = "image_generator_provider";
const LOCAL_GENERATOR = "Diffusers";

export function ImageGenSettings() {
  const user = useUser();
  return user.role === "admin" ? (
    <SettingsPane
      title="Image generation"
      description="Let people create images in chat, by asking the agent or with Create image. Choose a generator, try it, then turn it on."
    >
      <GeneratorSection key={user.id} />
      <TestSection />
      <PolicySection />
    </SettingsPane>
  ) : (
    <p role="alert">
      Administrator access is required to manage image generation.
    </p>
  );
}

function GeneratorSection() {
  const settings = useQuery({
    ...appSettingsGetOptions({ client }),
    staleTime: 0,
    retry: false,
  });
  const status = useQuery({
    ...imageGenerationProviderStatusOptions({ client }),
    staleTime: 0,
    retry: false,
  });
  const [draft, setDraft] = useState<ComponentProviderParameters | null>(null);
  const [saved, setSaved] = useState(false);
  const save = useMutation({
    ...appSettingUpdateMutation({ client }),
    meta: {
      invalidates: [
        appSettingsGetQueryKey({ client }),
        imageGenerationProviderStatusQueryKey({ client }),
        localImageOverviewQueryKey({ client }),
        imageGenerationAvailabilityQueryKey({ client }),
      ],
    },
    onSuccess() {
      setDraft(null);
      setSaved(true);
    },
  });

  if (!settings.data)
    return (
      <SettingsSection title="Generator">
        {settings.isError ? (
          <QueryError
            error={settings.error}
            message="The image generator could not be loaded."
            retry={() => settings.refetch()}
            isRetrying={settings.isFetching}
          />
        ) : (
          <Spinner />
        )}
      </SettingsSection>
    );

  const stored = settings.data.image_generator_provider ?? null;
  const selected = draft?.name ?? stored?.name ?? null;
  const change = (value: ComponentProviderParameters) => {
    setDraft(value);
    setSaved(false);
    save.reset();
  };

  return (
    <>
      <SettingsSection
        title="Generator"
        description="Use an existing ComfyUI server, or run a model on this server with Diffusers."
        actions={
          <Button
            disabled={!draft || save.isPending}
            onClick={() =>
              draft &&
              save.mutate({
                path: { key: SETTING_KEY },
                body: { value: draft },
              })
            }
          >
            {save.isPending ? "Saving…" : "Save generator"}
          </Button>
        }
      >
        <ComponentSettings
          key={stored?.name ?? "none"}
          component_type="ImageGenerator"
          settings_key={SETTING_KEY}
          defaultValue={stored}
          onProviderChange={(name) =>
            change({
              name,
              parameters: name === stored?.name ? stored.parameters : {},
            })
          }
          onUpdate={({ name, parameters }) =>
            change({ name, parameters: parameters as never })
          }
        />
        {save.isError && (
          <p role="alert" className="text-destructive text-sm">
            {errorText(save.error, "The generator could not be saved.")}
          </p>
        )}
        <p role="status" className="text-sm">
          {draft ? (
            <span className="font-medium">Unsaved changes</span>
          ) : saved ? (
            "Generator saved. "
          ) : null}
          {!draft && status.data && (
            <span
              data-testid="generator-status"
              className={status.data.ready ? "" : "text-muted-foreground"}
            >
              {status.data.ready ? "Ready" : "Not ready"}
              {status.data.detail ? `: ${status.data.detail}` : ""}
            </span>
          )}
        </p>
      </SettingsSection>
      {selected === LOCAL_GENERATOR && <LocalImageModels />}
    </>
  );
}

function TestSection() {
  const [prompt, setPrompt] = useState(
    "A lighthouse on a cliff at sunset, oil painting",
  );
  // The test image lands in the admin's files; refresh only those lists, not
  // the generator settings being edited above.
  const test = useMutation({
    ...imageGenerationTestMutation({ client }),
    meta: {
      invalidates: [
        fileGetManyQueryKey({ client }),
        fileGetManyInfiniteQueryKey({ client }),
      ],
    },
  });
  return (
    <SettingsSection
      title="Try it"
      description="Generates one image with the saved generator and puts it in your files. It works before image generation is turned on. A local model can take a few minutes to load the first time."
    >
      <div className="flex min-w-0 flex-wrap items-end gap-2">
        <div className="flex min-w-0 flex-1 basis-64 flex-col gap-1">
          <Label htmlFor="image-test-prompt">Prompt</Label>
          <Input
            id="image-test-prompt"
            value={prompt}
            maxLength={4000}
            onChange={(event) => setPrompt(event.target.value)}
          />
        </div>
        <Button
          variant="outline"
          disabled={!prompt.trim() || test.isPending}
          onClick={() => test.mutate({ body: { prompt: prompt.trim() } })}
        >
          {test.isPending ? "Generating…" : "Generate a test image"}
        </Button>
      </div>
      {test.isError && (
        <Alert variant="destructive">
          <AlertDescription>
            {errorText(test.error, "The test image could not be generated.")}
          </AlertDescription>
        </Alert>
      )}
      {test.data && (
        <figure className="flex flex-col items-start gap-1">
          <APIImage
            filename={test.data.filename}
            alt={`Test image: ${test.data.prompt}`}
            width={192}
            zoomable
          />
          <figcaption className="text-muted-foreground text-xs">
            {test.data.width}×{test.data.height} · {test.data.model} · seed{" "}
            {test.data.seed} · saved as {test.data.filename}
          </figcaption>
        </figure>
      )}
    </SettingsSection>
  );
}

function PolicySection() {
  const queryClient = useQueryClient();
  const policy = useQuery({
    ...imageGenerationPolicyGetOptions({ client }),
    staleTime: 0,
    retry: false,
  });
  const groups = useQuery({ ...groupGetManyOptions({ client }), retry: false });
  const [draft, setDraft] = useState<ImageGenerationPolicy | null>(null);
  const [saved, setSaved] = useState(false);
  const update = useMutation({
    ...imageGenerationPolicyUpdateMutation({ client }),
    // The policy is written below; only chat availability depends on it.
    meta: { invalidates: [imageGenerationAvailabilityQueryKey({ client })] },
    onSuccess(data) {
      queryClient.setQueryData(
        imageGenerationPolicyGetQueryKey({ client }),
        data,
      );
      setDraft(null);
      setSaved(true);
    },
  });

  if (!policy.data)
    return (
      <SettingsSection title="Availability">
        {policy.isError ? (
          <QueryError
            error={policy.error}
            message="The image generation policy could not be loaded."
            retry={() => policy.refetch()}
            isRetrying={policy.isFetching}
          />
        ) : (
          <Spinner />
        )}
      </SettingsSection>
    );

  const current = draft ?? policy.data;
  const enabled = current.enabled ?? false;
  const limited = current.group_ids != null;
  const chosen = new Set(current.group_ids ?? []);
  const change = (next: ImageGenerationPolicy) => {
    setDraft(next);
    setSaved(false);
    update.reset();
  };

  return (
    <SettingsSection
      title="Availability"
      description="Off by default. Every request is checked and recorded; prompts that sexualize minors are always refused."
      actions={
        <Button
          disabled={!draft || update.isPending}
          onClick={() =>
            update.mutate({
              body: { enabled, group_ids: current.group_ids ?? null },
            })
          }
        >
          {update.isPending ? "Saving…" : "Save availability"}
        </Button>
      }
    >
      <FieldGroup>
        <Field orientation="horizontal">
          <Switch
            id="image-generation-enabled"
            checked={enabled}
            disabled={update.isPending}
            onCheckedChange={(value) => change({ ...current, enabled: value })}
          />
          <div className="flex flex-col gap-1">
            <FieldLabel htmlFor="image-generation-enabled">
              Enable image generation
            </FieldLabel>
            <FieldDescription>
              The agent can create images when the chat&apos;s model supports
              tools; Create image works with any model.
            </FieldDescription>
          </div>
        </Field>
        <Field orientation="horizontal">
          <Switch
            id="image-generation-limited"
            checked={limited}
            disabled={update.isPending}
            onCheckedChange={(value) =>
              change({ ...current, group_ids: value ? [] : null })
            }
          />
          <div className="flex flex-col gap-1">
            <FieldLabel htmlFor="image-generation-limited">
              Limit to selected groups
            </FieldLabel>
            <FieldDescription>
              Off: every group may generate images.
            </FieldDescription>
          </div>
        </Field>
      </FieldGroup>
      {limited && (
        <ul aria-label="Groups allowed to generate images" className="pl-10">
          {(groups.data ?? []).map((group) => (
            <li key={group.id} className="flex items-center gap-2 py-1">
              <Checkbox
                id={`image-group-${group.id}`}
                checked={chosen.has(group.id)}
                onCheckedChange={(checked) => {
                  const next = new Set(chosen);
                  if (checked) next.add(group.id);
                  else next.delete(group.id);
                  change({ ...current, group_ids: [...next].sort() });
                }}
              />
              <Label htmlFor={`image-group-${group.id}`}>{group.name}</Label>
            </li>
          ))}
          {groups.isError && (
            <li role="alert" className="text-destructive text-sm">
              Groups could not be loaded.
            </li>
          )}
        </ul>
      )}
      {update.isError && (
        <p role="alert" className="text-destructive text-sm">
          {errorText(update.error, "The policy could not be saved.")}
        </p>
      )}
      <p role="status" className="text-muted-foreground text-sm">
        {draft ? (
          <span className="text-foreground font-medium">Unsaved changes</span>
        ) : saved ? (
          "Availability saved."
        ) : null}
      </p>
    </SettingsSection>
  );
}
