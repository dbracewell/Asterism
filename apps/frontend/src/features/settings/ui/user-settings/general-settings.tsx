import { useUpdateUserSettings } from "@/features/settings/hooks/use-update-user-settings";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { LlmModel } from "@/lib/client";
import { useUser } from "@/features/auth/components/user-context";

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
          defaultValue={
            userSettings?.chat_model
              ? `${userSettings.chat_model.provider_id}::${userSettings.chat_model.name}`
              : undefined
          }
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
            {userSettings?.models?.map((model) => (
              <SelectItem
                value={`${model.provider_id}::${model.name}`}
                key={`${model.provider_id}::${model.name}`}
              >
                {model.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
};
