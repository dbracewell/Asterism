"use client";

import { EmptyState } from "@/components/empty-state";
import { HelpTopic } from "@/features/help/components/help-topic";
import { ListSkeleton } from "@/components/loading-skeletons";
import { QueryError } from "@/components/query-error";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { useUser } from "@/features/auth/components/user-context";
import {
  SettingsPane,
  SettingsSection,
} from "@/features/settings/ui/settings-section";
import { useQuery } from "@tanstack/react-query";
import { useRef, useState, type MouseEvent } from "react";
import {
  bundledRubricsOptions,
  LIBRARY_PAGE_SIZE,
  rubricLibraryOptions,
} from "../queries";
import {
  RubricEditorDialog,
  type RubricEditorTarget,
} from "./rubric-editor-dialog";
import { TemplateRow, TemplateRows } from "./templates-settings";

/** User Settings → Rubrics: bundled rubrics and the user's own (US-57.1). */
export function RubricsSettings() {
  const user = useUser();
  return <OwnedRubricsSettings key={user.id} owner={user.id} />;
}

function OwnedRubricsSettings({ owner }: { owner: string }) {
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<RubricEditorTarget | null>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const newButton = useRef<HTMLButtonElement>(null);
  const bundled = useQuery(bundledRubricsOptions());
  const rubrics = useQuery(rubricLibraryOptions(owner, query, page));
  const lastPage = rubrics.data
    ? Math.max(1, Math.ceil(rubrics.data.total / LIBRARY_PAGE_SIZE))
    : page;
  if (page > lastPage) setPage(lastPage);
  const open = (event: MouseEvent<HTMLElement>, target: RubricEditorTarget) => {
    returnFocus.current = event.currentTarget;
    setEditing(target);
  };
  const search = (value: string) => {
    setQuery(value);
    setPage(1);
  };
  return (
    <SettingsPane
      title="Rubrics"
      description="Assessment rubrics for Draft feedback mode. Choose one in the composer and the feedback is organized by its criteria."
      actions={
        <Button
          ref={newButton}
          onClick={(event) => open(event, { type: "new" })}
        >
          New rubric
        </Button>
      }
    >
      <SettingsSection
        title="Bundled rubrics"
        description="Read-only. Duplicate one to adapt it to your assignment."
      >
        {bundled.isPending && (
          <ListSkeleton label="Loading rubrics…" rows={3} detail />
        )}
        {bundled.error && (
          <QueryError
            error={bundled.error}
            message="Could not load bundled rubrics."
            retry={bundled.refetch}
            isRetrying={bundled.isFetching}
          />
        )}
        {bundled.data && (
          <TemplateRows label="Bundled rubrics">
            {bundled.data.items.map((rubric) => (
              <TemplateRow
                key={rubric.id}
                name={rubric.name}
                description={rubric.description}
                meta={`Bundled · ${rubric.document.criteria.length} criteria · revision ${rubric.revision}`}
              >
                <Button
                  variant="outline"
                  aria-label={`Duplicate ${rubric.name}`}
                  onClick={(event) =>
                    open(event, {
                      type: "duplicate",
                      source: "bundled",
                      id: rubric.id,
                    })
                  }
                >
                  Duplicate
                </Button>
              </TemplateRow>
            ))}
          </TemplateRows>
        )}
      </SettingsSection>
      <SettingsSection title="Your rubrics">
        <Field>
          <FieldLabel htmlFor="rubric-search">Search rubrics</FieldLabel>
          <Input
            id="rubric-search"
            maxLength={200}
            value={query}
            onChange={(event) => search(event.target.value)}
          />
        </Field>
        {rubrics.isPending && (
          <ListSkeleton label="Loading your rubrics…" rows={3} detail />
        )}
        {rubrics.error && (
          <QueryError
            error={rubrics.error}
            message={
              rubrics.data
                ? "Could not refresh rubrics. Showing saved results."
                : "Could not load your rubrics."
            }
            retry={rubrics.refetch}
            isRetrying={rubrics.isFetching}
          />
        )}
        {rubrics.data?.total === 0 && (
          <EmptyState
            title={query ? "No matching rubrics" : "No rubrics yet"}
            help={query ? undefined : <HelpTopic id="concept.rubric" />}
            description={
              query
                ? "Try a different name or description."
                : "Duplicate a bundled rubric above, or enter your assignment's rubric from scratch."
            }
            action={
              query ? (
                <Button variant="outline" onClick={() => search("")}>
                  Clear search
                </Button>
              ) : (
                <Button
                  variant="outline"
                  onClick={(event) => open(event, { type: "new" })}
                >
                  Create a rubric
                </Button>
              )
            }
          />
        )}
        {!!rubrics.data?.items.length && (
          <TemplateRows label="Your rubrics">
            {rubrics.data.items.map((rubric) => (
              <TemplateRow
                key={rubric.id}
                name={rubric.name}
                description={rubric.description}
                meta={`Revision ${rubric.revision}`}
              >
                <Button
                  variant="outline"
                  aria-label={`Duplicate ${rubric.name}`}
                  onClick={(event) =>
                    open(event, {
                      type: "duplicate",
                      source: "owned",
                      id: rubric.id,
                    })
                  }
                >
                  Duplicate
                </Button>
                <Button
                  variant="outline"
                  aria-label={`Edit ${rubric.name}`}
                  onClick={(event) =>
                    open(event, { type: "edit", id: rubric.id })
                  }
                >
                  Edit
                </Button>
              </TemplateRow>
            ))}
          </TemplateRows>
        )}
        {rubrics.data && rubrics.data.total > LIBRARY_PAGE_SIZE && (
          <nav
            aria-label="Rubric pages"
            className="flex flex-wrap items-center justify-end gap-3"
          >
            <Button
              variant="outline"
              disabled={page === 1 || rubrics.isFetching}
              onClick={() => setPage(page - 1)}
            >
              Previous rubrics
            </Button>
            <span>
              Page {page} of {lastPage}
            </span>
            <Button
              variant="outline"
              disabled={page === lastPage || rubrics.isFetching}
              onClick={() => setPage(page + 1)}
            >
              Next rubrics
            </Button>
          </nav>
        )}
      </SettingsSection>
      {editing && (
        <RubricEditorDialog
          owner={owner}
          target={editing}
          onClose={(deleted) => {
            if (deleted) returnFocus.current = null;
            setEditing(null);
          }}
          restoreFocus={() => {
            if (returnFocus.current?.isConnected) returnFocus.current.focus();
            else newButton.current?.focus();
          }}
        />
      )}
    </SettingsPane>
  );
}
