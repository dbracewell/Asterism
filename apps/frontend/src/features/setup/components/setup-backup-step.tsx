"use client";

import { CopyButton } from "@/components/copy-button";
import { QueryError } from "@/components/query-error";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import {
  SettingsPane,
  SettingsSection,
} from "@/features/settings/ui/settings-section";
import { client } from "@/lib/api";
import { statusGetOptions } from "@/lib/client/@tanstack/react-query.gen";
import { formatFileSize } from "@/lib/formatters";
import { formatFullTimestamp } from "@/lib/relative-time";
import { useQuery } from "@tanstack/react-query";

export const BACKUP_COMMAND =
  "docker compose exec -T asterism /app/docker/entrypoint.sh backup --keep 14";
export const VERIFY_COMMAND =
  "docker compose exec -T asterism /app/docker/entrypoint.sh verify /backups/<file>";

/**
 * The walkthrough's first-backup step (US-101.3): why SYSTEM_KEY must be kept
 * apart from the backups, the commands that take and check one, and the last
 * backup the server recorded. Backups run from the server's command line, so
 * this pane shows the commands rather than running them.
 */
export function SetupBackupStep() {
  return (
    <SettingsPane
      title="First backup"
      description="Back up nightly and before every upgrade. A backup holds the databases, files and settings, not the secrets in .env."
    >
      <SettingsSection
        title="Keep the secrets apart from the backups"
        description="The setup command wrote them to .env."
      >
        <ul className="flex list-disc flex-col gap-2 pl-5 text-sm">
          <li>
            <strong>SYSTEM_KEY</strong> encrypts the provider keys Asterism
            stores. A backup can only be restored with the SYSTEM_KEY it was
            made with, and backups don&apos;t contain it. Without it, the backup
            can&apos;t be restored.
          </li>
          <li>
            <strong>BETTER_AUTH_SECRET</strong> signs people in. A restore with
            a different one signs everyone out.
          </li>
          <li>
            Keep copies of both somewhere safe, such as a password manager, and
            not with the backups.
          </li>
        </ul>
      </SettingsSection>
      <SettingsSection
        title="Take a backup"
        description="Run these on the server, in the directory with compose.yaml, while Asterism is running. Then copy the backups volume off the server."
      >
        <Command
          label="Take a backup, keeping the last 14"
          text={BACKUP_COMMAND}
        />
        <Command label="Check a backup can be restored" text={VERIFY_COMMAND} />
      </SettingsSection>
      <LastBackup />
    </SettingsPane>
  );
}

function Command({ label, text }: { label: string; text: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <p className="text-sm font-medium">{label}</p>
      <div className="bg-muted rounded-control flex min-w-0 items-start gap-2 p-2">
        <pre className="min-w-0 flex-1 overflow-x-auto font-mono text-xs [overflow-wrap:anywhere] whitespace-pre-wrap">
          <code>{text}</code>
        </pre>
        <CopyButton text={text} />
      </div>
    </div>
  );
}

function LastBackup() {
  const status = useQuery({ ...statusGetOptions({ client }), retry: false });
  const backup = status.data?.last_backup;
  return (
    <SettingsSection
      title="Last backup"
      actions={
        <Button
          variant="outline"
          disabled={status.isFetching}
          onClick={() => status.refetch()}
        >
          {status.isFetching ? "Checking…" : "Check again"}
        </Button>
      }
    >
      {status.isPending ? (
        <Spinner />
      ) : !status.data ? (
        <QueryError
          error={status.error}
          message="The last backup could not be checked."
          retry={() => status.refetch()}
          isRetrying={status.isFetching}
        />
      ) : backup ? (
        <p className="text-sm" role="status">
          Last backup{" "}
          {formatFullTimestamp(
            new Date(backup.created_at * 1000),
            Intl.DateTimeFormat().resolvedOptions().timeZone,
          )}
          : {backup.archive} ({formatFileSize(backup.size_bytes, 1)}).
        </p>
      ) : (
        <p className="text-sm" role="status">
          No backup has been recorded yet. Take one with the command above, then
          check again.
        </p>
      )}
    </SettingsSection>
  );
}
