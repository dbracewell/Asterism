import { WelcomeHeader } from "@/features/dashboard/components/welcome-header";
import { IconMessageCircleStar, IconRobotFace } from "@tabler/icons-react";

import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";

export default function AppPage() {
  return (
    <div className="flex flex-1 flex-col items-start gap-2 p-2">
      <WelcomeHeader />
      <div className="grid w-full flex-1 grid-cols-1 items-center rounded-md md:grid-cols-2">
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <IconMessageCircleStar />
            </EmptyMedia>
            <EmptyTitle>No Chat Sessions Yet</EmptyTitle>
            <EmptyDescription>
              You haven&apos;t created any chat sessions yet. Get started by
              starting your first session.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent className="flex-row justify-center gap-2">
            <Button>Start chatting</Button>
          </EmptyContent>
        </Empty>
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <IconRobotFace />
            </EmptyMedia>
            <EmptyTitle>No Custom Agents Yet</EmptyTitle>
            <EmptyDescription>
              You haven&apos;t created any custom agents yet. Get started by
              creating your first custom agent.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent className="flex-row justify-center gap-2">
            <Button>Create a custom agent</Button>
          </EmptyContent>
        </Empty>
      </div>
    </div>
  );
}
