import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PencilIcon, PlusIcon, Trash2Icon, XIcon } from "lucide-react";
import { useState } from "react";

export const ProvidersTab = () => {
  const [activeEditor, setActiveEditor] = useState<string | null>(null);
  return (
    <div className="flex w-full max-w-xl flex-col gap-2 py-5">
      <div className="relative">
        <h1 className="border-b pb-2 text-center">
          OpenAI Compataiable Providers
        </h1>
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
      <ProviderForm
        isActive={activeEditor === "<ROOT>"}
        onClose={() => setActiveEditor(null)}
      />
      <ProviderEntry
        activeEditor={activeEditor}
        setActiveEditor={setActiveEditor}
      />
      <ProviderEntry
        activeEditor={activeEditor}
        setActiveEditor={setActiveEditor}
      />
    </div>
  );
};

const ProviderEntry = ({
  activeEditor,
  setActiveEditor,
}: {
  activeEditor: string | null;
  setActiveEditor: (value: string | null) => void;
}) => {
  return (
    <div className="grid grid-cols-[2fr_1fr] gap-2">
      <h3 className="truncate text-sm">LM Studio (mac-ai-server)</h3>
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
          isActive={activeEditor === "1"}
          onClose={() => setActiveEditor(null)}
        />
      </div>
    </div>
  );
};

const ProviderForm = ({
  isActive,
  onClose,
}: {
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
        <Input />
        <h3 className="text-right">Base Url:</h3>
        <Input />
        <h3 className="text-right">Api Key:</h3>
        <Input />
        <h3 className="text-right">Prefix:</h3>
        <Input />
        <h3 className="text-right">Models:</h3>
        <Input />
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
