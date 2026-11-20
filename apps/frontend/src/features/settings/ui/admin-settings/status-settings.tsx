"use client";

import { useQuery } from "@tanstack/react-query";
import { ListSkeleton } from "@/components/loading-skeletons";
import { QueryError } from "@/components/query-error";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { SettingsSection } from "@/features/settings/ui/settings-section";
import { client } from "@/lib/api";
import type { Capacity, InstanceStatus, Readiness } from "@/lib/client";
import {
  healthReadyOptions,
  statusGetOptions,
} from "@/lib/client/@tanstack/react-query.gen";
import { formatFileSize } from "@/lib/formatters";
import { formatFullTimestamp } from "@/lib/relative-time";

const REFRESH_MS = 15_000;
const DAY = 86_400;

/** Admin Settings → Status: what the instance is doing now (US-86.6). */
export function StatusSettings() {
  const status = useQuery({
    ...statusGetOptions({ client }),
    refetchInterval: REFRESH_MS,
  });
  // A 503 (not ready) arrives as the query error; its body is still the readiness result.
  const readiness = useQuery({
    ...healthReadyOptions({ client }),
    refetchInterval: REFRESH_MS,
    retry: false,
  });
  const ready =
    readiness.data ??
    (readiness.error as unknown as Readiness | null) ??
    undefined;
  return (
    <div className="grid gap-6">
      {status.isPending && <ListSkeleton label="Loading status…" />}
      {status.error && (
        <QueryError
          error={status.error}
          message="Could not load the status."
          retry={status.refetch}
          isRetrying={status.isFetching}
        />
      )}
      {status.data && (
        <StatusSections
          status={status.data}
          readiness={ready?.checks ? ready : undefined}
        />
      )}
    </div>
  );
}

function formatUptime(seconds: number) {
  const days = Math.floor(seconds / DAY);
  const hours = Math.floor((seconds % DAY) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days) return `${days} d ${hours} h`;
  if (hours) return `${hours} h ${minutes} min`;
  return `${minutes} min`;
}

function CapacityRow({
  label,
  capacity,
}: {
  label: string;
  capacity: Capacity;
}) {
  const percent = capacity.limit
    ? Math.min(100, Math.round((capacity.used / capacity.limit) * 100))
    : 0;
  return (
    <div className="grid gap-1">
      <div className="flex justify-between gap-2">
        <span>{label}</span>
        <span>
          {capacity.used} of {capacity.limit}
        </span>
      </div>
      <Progress
        value={percent}
        aria-label={`${label}: ${percent}% of the limit`}
      />
    </div>
  );
}

function Fact({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid gap-0.5">
      <dt className="text-muted-foreground">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function StatusSections({
  status,
  readiness,
}: {
  status: InstanceStatus;
  readiness?: Readiness;
}) {
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const storage = status.storage;
  const lowSpace = storage.free_bytes < storage.min_free_bytes;
  // The server's clock at the response, so a wrong browser clock can't hide a stale backup.
  const serverNow = status.started_at + status.uptime_seconds;
  const backupAge = status.last_backup
    ? serverNow - status.last_backup.created_at
    : null;
  return (
    <>
      <SettingsSection
        title="Instance"
        description="Refreshes every 15 seconds."
        actions={
          readiness && (
            <Badge variant={readiness.ready ? "secondary" : "destructive"}>
              {readiness.ready ? "Ready" : "Not ready"}
            </Badge>
          )
        }
      >
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          <Fact label="Version">{status.version}</Fact>
          <Fact label="Commit">
            {status.commit === "unknown" ? (
              "Unknown"
            ) : (
              <code title={status.commit}>{status.commit.slice(0, 12)}</code>
            )}
          </Fact>
          <Fact label="Schema revision">
            <code>{status.schema_revision}</code>
          </Fact>
          <Fact label="Running for">{formatUptime(status.uptime_seconds)}</Fact>
          <Fact label="Logs">
            {status.log_level}, {status.log_format}
          </Fact>
        </dl>
        {readiness && !readiness.ready && (
          <ul role="alert" className="text-destructive grid gap-1 text-sm">
            {readiness.checks
              .filter((check) => !check.ok)
              .map((check) => (
                <li key={check.name}>{check.detail}</li>
              ))}
          </ul>
        )}
      </SettingsSection>
      <SettingsSection
        title="Work"
        description="Chats past their limit are refused with “capacity is full” until a slot frees up."
      >
        <div className="grid gap-4 text-sm">
          <CapacityRow
            label="Replies running"
            capacity={status.active_chat_runs}
          />
          <CapacityRow
            label="Open chat connections"
            capacity={status.chat_connections}
          />
          <p>
            File processing: {status.knowledge_running} running,{" "}
            {status.knowledge_queued} waiting.
          </p>
        </div>
      </SettingsSection>
      <SettingsSection title="Storage">
        <dl className="grid gap-3 text-sm sm:grid-cols-3">
          <Fact label="Asterism data">
            {storage.used_bytes == null
              ? "Measuring…"
              : formatFileSize(storage.used_bytes, 1)}
          </Fact>
          <Fact label="Free on disk">
            <span className={lowSpace ? "text-destructive" : undefined}>
              {formatFileSize(storage.free_bytes, 1)} of{" "}
              {formatFileSize(storage.total_bytes, 1)}
            </span>
          </Fact>
          <Fact label="Not ready below">
            {formatFileSize(storage.min_free_bytes, 1)}
          </Fact>
        </dl>
      </SettingsSection>
      <SettingsSection
        title="Backups"
        description="Backups are taken from the server's command line; see the backup and restore guide."
      >
        {status.last_backup ? (
          <p
            className={
              backupAge != null && backupAge > 2 * DAY
                ? "text-destructive text-sm"
                : "text-sm"
            }
          >
            Last backup{" "}
            {formatFullTimestamp(
              new Date(status.last_backup.created_at * 1000),
              zone,
            )}
            : {status.last_backup.archive} (
            {formatFileSize(status.last_backup.size_bytes, 1)})
            {backupAge != null &&
              backupAge > 2 * DAY &&
              ". That is more than two days ago."}
          </p>
        ) : (
          <p className="text-destructive text-sm">
            No backup has been recorded.
          </p>
        )}
      </SettingsSection>
    </>
  );
}
