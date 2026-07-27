"use client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PencilIcon, PlusIcon, Trash2Icon, XIcon } from "lucide-react";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { appSettingsGetOptions } from "@/lib/client/@tanstack/react-query.gen";
import { client } from "@/lib/api";
import { LlmProvider } from "@/lib/client";
import { Checkbox } from "@/components/ui/checkbox";

export const ProvidersTab = () => {
  const [activeEditor, setActiveEditor] = useState<string | null>(null);
  const { data: appSettings } = useQuery({
    ...appSettingsGetOptions({
      client: client,
    }),
  });

  return (
    <div className="flex w-full max-w-xl flex-col gap-2 py-5">
      <div className="relative">
        <h1 className="border-b pb-2 text-center">LLM Providers</h1>
        <Button
          variant="ghost"
          size="icon-sm"
          disabled={activeEditor === "<ROOT>"}
          onClick={() => setActiveEditor("<ROOT>")}
          className="absolute top-1 right-0"
        >
          <PlusIcon />
        </Button>
      </div>
      {appSettings?.llm_providers?.map((provider) => (
        <ProviderEntry
          activeEditor={activeEditor}
          setActiveEditor={setActiveEditor}
          key={provider.name}
          provider={provider}
        />
      ))}
      <ProviderForm
        isActive={activeEditor === "<ROOT>"}
        onClose={() => setActiveEditor(null)}
      />
    </div>
  );
};

const ProviderEntry = ({
  provider,
  activeEditor,
  setActiveEditor,
}: {
  provider: LlmProvider;
  activeEditor: string | null;
  setActiveEditor: (value: string | null) => void;
}) => {
  return (
    <div className="grid grid-cols-[2fr_1fr] gap-2">
      <h3 className="truncate text-sm">{provider.name}</h3>
      <div className="flex items-center justify-end gap-2 [&_svg]:size-4">
        <Trash2Icon />
        <Button
          onClick={() => setActiveEditor("1")}
          variant="ghost"
          className="rounded"
        >
          <PencilIcon />
        </Button>
      </div>
      <div className="col-span-2">
        <ProviderForm
          initialData={provider}
          isActive={activeEditor === "1"}
          onClose={() => setActiveEditor(null)}
        />
      </div>
    </div>
  );
};

const ProviderForm = ({
  initialData,
  isActive,
  onClose,
}: {
  initialData?: LlmProvider;
  isActive: boolean;
  onClose: () => void;
}) => {
  if (!isActive) {
    return null;
  }
  return (
    <div className="bg-background/30 mb-5 rounded border p-2 text-sm">
      <h1 className="pb-3 text-center">Add Provider</h1>
      <div className="grid grid-cols-[1fr_2fr] gap-2">
        <h3 className="text-right">Provider Name:</h3>
        <Input defaultValue={initialData?.name} />
        <h3 className="text-right">Base Url:</h3>
        <Input defaultValue={initialData?.base_url} />
        <h3 className="text-right">Api Key:</h3>
        <Input defaultValue={initialData?.api_key} />
        <h3 className="text-right">Models:</h3>
        {initialData?.models.map((model) => (
          <div className="flex items-center gap-1" key={model.name}>
            <Checkbox checked={model.is_active} /> <span>{model.name}</span>
          </div>
        ))}
        <div className="col-span-2 flex items-center justify-end gap-2">
          <Button variant="outline" onClick={() => onClose()}>
            <XIcon /> Cancel
          </Button>
          <Button>
            <PlusIcon /> Add
          </Button>
        </div>
      </div>
    </div>
  );
};
