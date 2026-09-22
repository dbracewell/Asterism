import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AgentProfile } from "@/lib/client/types.gen";

export type AgentSelectorProps = {
  agents: AgentProfile[];
  value: string;
  onValueChange: (value: string) => void;
  className?: string;
  chevronClassName?: string;
  disabled?: boolean;
};

export const AgentSelector = ({
  agents,
  value,
  onValueChange,
  className,
  chevronClassName,
  disabled = false,
}: AgentSelectorProps) => {
  return (
    <Select disabled={disabled} value={value} onValueChange={onValueChange}>
      <SelectTrigger className={className} chevronClassName={chevronClassName}>
        <SelectValue placeholder="Select a main agent" />
      </SelectTrigger>
      <SelectContent>
        {agents.map((agent) => (
          <SelectItem key={agent.id} value={agent.id!}>
            {agent.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
};
