"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { useId, useState } from "react";
import { ListSkeleton } from "@/components/loading-skeletons";
import { QueryError } from "@/components/query-error";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { SettingsSection } from "@/features/settings/ui/settings-section";
import { dayInZone, formatCost, formatTokens } from "@/features/usage/format";
import { client } from "@/lib/api";
import type { UsageReport, UsageUserRow } from "@/lib/client";
import {
  usageGetReportOptions,
  usageSettingsGetOptions,
  usageSettingsUpdateMutation,
} from "@/lib/client/@tanstack/react-query.gen";
import { errorDetail } from "@/lib/utils";

/** Admin Settings → Usage: tokens and estimated cost per user, model and group (US-86.3). */
export function UsageSettings() {
  const settings = useQuery(usageSettingsGetOptions({ client }));
  return (
    <div className="grid gap-6">
      {settings.isPending && <ListSkeleton label="Loading usage settings…" />}
      {settings.error && (
        <QueryError
          error={settings.error}
          message="Could not load usage settings."
          retry={settings.refetch}
          isRetrying={settings.isFetching}
        />
      )}
      {settings.data && (
        <>
          <UsageReportSection
            key={settings.data.timezone}
            timeZone={settings.data.timezone}
          />
          <TimezoneSection
            key={`zone-${settings.data.timezone}`}
            timeZone={settings.data.timezone}
          />
        </>
      )}
    </div>
  );
}

function firstOfMonth(day: string) {
  return `${day.slice(0, 8)}01`;
}

function UsageReportSection({ timeZone }: { timeZone: string }) {
  const id = useId();
  const today = dayInZone(new Date(), timeZone);
  const [start, setStart] = useState(firstOfMonth(today));
  const [end, setEnd] = useState(today);
  const valid = Boolean(start && end && start <= end);
  const report = useQuery({
    ...usageGetReportOptions({ client, query: { start, end } }),
    enabled: valid,
  });
  return (
    <SettingsSection
      title="Usage"
      description={`Input and output tokens of every model call, and images made, per user and model. Cost is estimated from each model's price when the call ran. Days follow ${timeZone}.`}
    >
      <form
        className="flex flex-wrap items-end gap-4"
        onSubmit={(event) => event.preventDefault()}
      >
        <div className="grid gap-1">
          <Label htmlFor={`${id}-start`}>From</Label>
          <Input
            id={`${id}-start`}
            type="date"
            className="w-44"
            value={start}
            max={end || undefined}
            onChange={(event) => setStart(event.target.value)}
          />
        </div>
        <div className="grid gap-1">
          <Label htmlFor={`${id}-end`}>To (included)</Label>
          <Input
            id={`${id}-end`}
            type="date"
            className="w-44"
            value={end}
            min={start || undefined}
            onChange={(event) => setEnd(event.target.value)}
          />
        </div>
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            setStart(firstOfMonth(today));
            setEnd(today);
          }}
        >
          This month
        </Button>
      </form>
      {!valid && (
        <p role="alert" className="text-destructive text-sm">
          Choose a start date on or before the end date.
        </p>
      )}
      {valid && report.isPending && <ListSkeleton label="Loading usage…" />}
      {report.error && (
        <QueryError
          error={report.error}
          message={errorDetail(report.error, "Could not load usage.")}
          retry={report.refetch}
          isRetrying={report.isFetching}
        />
      )}
      {valid && report.data && <ReportTables report={report.data} />}
    </SettingsSection>
  );
}

function ReportTables({ report }: { report: UsageReport }) {
  if (report.users.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">No usage in this period.</p>
    );
  }
  return (
    <div className="grid gap-6">
      <p className="text-sm">
        {formatTokens(report.total_tokens)} · estimated{" "}
        {formatCost(report.cost_usd)}
      </p>
      <Table aria-label="Usage per group">
        <TableHeader>
          <TableRow>
            <TableHead>Group</TableHead>
            <TableHead className="text-right">Users</TableHead>
            <TableHead className="text-right">Tokens</TableHead>
            <TableHead className="text-right">Images</TableHead>
            <TableHead className="text-right">Estimated cost</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {report.groups.map((group) => (
            <TableRow key={group.group_id ?? "none"}>
              <TableCell>{group.group_name ?? "No group"}</TableCell>
              <TableCell className="text-right">{group.users}</TableCell>
              <TableCell className="text-right">
                {group.total_tokens.toLocaleString("en-US")}
              </TableCell>
              <TableCell className="text-right">{group.images}</TableCell>
              <TableCell className="text-right">
                {formatCost(group.cost_usd)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <Table aria-label="Usage per user and model">
        <TableHeader>
          <TableRow>
            <TableHead>User</TableHead>
            <TableHead>Model</TableHead>
            <TableHead className="text-right">Input</TableHead>
            <TableHead className="text-right">Output</TableHead>
            <TableHead className="text-right">Images</TableHead>
            <TableHead className="text-right">Estimated cost</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {report.users.map((user) => (
            <UserRows key={user.user_id} user={user} />
          ))}
        </TableBody>
        <TableFooter>
          <TableRow>
            <TableCell colSpan={5}>Total</TableCell>
            <TableCell className="text-right">
              {formatCost(report.cost_usd)}
            </TableCell>
          </TableRow>
        </TableFooter>
      </Table>
      <p className="text-muted-foreground text-xs">
        &ldquo;—&rdquo; means no price: the model has none set, or it ran on a
        member&apos;s ChatGPT plan. Images made with local or ComfyUI generators
        use no tokens.
      </p>
    </div>
  );
}

function UserRows({ user }: { user: UsageUserRow }) {
  const label = user.name || user.email || user.user_id;
  return (
    <>
      {user.models.map((model, index) => (
        <TableRow key={`${model.model_id ?? "none"}-${model.model_name}`}>
          {index === 0 && (
            <TableCell rowSpan={user.models.length} className="align-top">
              <span className="font-medium">{label}</span>
              {user.email && user.email !== label && (
                <span className="text-muted-foreground block">
                  {user.email}
                </span>
              )}
              <span className="text-muted-foreground block">
                {user.group_name ?? "No group"} ·{" "}
                {formatTokens(user.total_tokens)}
              </span>
            </TableCell>
          )}
          <TableCell>{model.model_name || "Unknown model"}</TableCell>
          <TableCell className="text-right">
            {model.input_tokens.toLocaleString("en-US")}
          </TableCell>
          <TableCell className="text-right">
            {model.output_tokens.toLocaleString("en-US")}
          </TableCell>
          <TableCell className="text-right">{model.images}</TableCell>
          <TableCell className="text-right">
            {formatCost(model.cost_usd)}
          </TableCell>
        </TableRow>
      ))}
    </>
  );
}

function TimezoneSection({ timeZone }: { timeZone: string }) {
  const id = useId();
  const [value, setValue] = useState(timeZone);
  const [saved, setSaved] = useState(false);
  const save = useMutation({
    ...usageSettingsUpdateMutation({ client }),
    onSuccess: () => setSaved(true),
  });
  const trimmed = value.trim();
  return (
    <SettingsSection
      title="Budget day"
      description="Daily budgets reset at midnight, and monthly budgets on the 1st, in this timezone, for everyone. Use your school's timezone."
    >
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          save.mutate({ body: { timezone: trimmed } });
        }}
      >
        <div className="grid gap-1">
          <Label htmlFor={`${id}-zone`}>Timezone (IANA name)</Label>
          <Input
            id={`${id}-zone`}
            className="w-64"
            placeholder="Europe/London"
            value={value}
            onChange={(event) => {
              setSaved(false);
              setValue(event.target.value);
            }}
            disabled={save.isPending}
          />
        </div>
        <Button
          type="submit"
          disabled={!trimmed || trimmed === timeZone || save.isPending}
        >
          {save.isPending ? "Saving…" : "Save timezone"}
        </Button>
      </form>
      {save.error && (
        <p role="alert" className="text-destructive text-sm">
          {errorDetail(save.error, "Could not save the timezone.")}
        </p>
      )}
      {saved && (
        <p role="status" className="text-sm">
          Timezone saved.
        </p>
      )}
    </SettingsSection>
  );
}
