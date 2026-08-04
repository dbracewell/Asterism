import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useUser } from "@/features/auth/components/user-context";
import { useUpdateUserSettings } from "@/features/settings/hooks/use-update-user-settings";
import { LlmModel } from "@/lib/client";

export const GeneralSettings = () => {
  const { updateSetting } = useUpdateUserSettings();
  const user = useUser();
  const userSettings = user.settings;

  return (
    <div className="flex flex-1 flex-col gap-3 p-2">
      <h1 className="border-b pb-2 font-bold">Chat Settings</h1>
      <div className="flex flex-col items-center gap-2 sm:flex-row">
        <h2>Model</h2>
        <Select
          defaultValue={userSettings.default_model_id ?? undefined}
          onValueChange={(v) => {
            const [provider_id, name] = v.split("::");
            updateSetting("chat_model", {
              provider_id,
              name,
            } as LlmModel);
          }}
        >
          <SelectTrigger className="w-50">
            <SelectValue className="truncate" />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(userSettings.models ?? {}).map(([key, model]) => (
              <SelectItem value={key} key={key}>
                {model.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
};
