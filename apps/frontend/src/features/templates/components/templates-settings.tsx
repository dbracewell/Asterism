"use client";

import { HelpTopic } from "@/features/help/components/help-topic";
import { EmptyState } from "@/components/empty-state";
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
import { useRef, useState, type MouseEvent, type ReactNode } from "react";
import {
  frameworkCatalogOptions,
  LIBRARY_PAGE_SIZE,
  templateLibraryOptions,
} from "../queries";
import {
  TemplateEditorDialog,
  type EditorTarget,
} from "./template-editor-dialog";

export function TemplatesSettings() {
  const user = useUser();
  return <OwnedTemplatesSettings key={user.id} owner={user.id} />;
}

function OwnedTemplatesSettings({ owner }: { owner: string }) {
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<EditorTarget | null>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const newButton = useRef<HTMLButtonElement>(null);
  const frameworks = useQuery(frameworkCatalogOptions());
  const templates = useQuery(templateLibraryOptions(owner, query, page));
  const lastPage = templates.data
    ? Math.max(1, Math.ceil(templates.data.total / LIBRARY_PAGE_SIZE))
    : page;
  if (page > lastPage) setPage(lastPage);
  const open = (event: MouseEvent<HTMLElement>, target: EditorTarget) => {
    returnFocus.current = event.currentTarget;
    setEditing(target);
  };
  const search = (value: string) => {
    setQuery(value);
    setPage(1);
  };
  return (
    <SettingsPane
      title="Templates"
      description="Prompt frameworks and your own templates for the composer's template builder."
      actions={
        <Button
          ref={newButton}
          onClick={(event) => open(event, { type: "new" })}
        >
          New template
        </Button>
      }
    >
      <SettingsSection
        title="Frameworks"
        description="Bundled and read-only. Duplicate one to customize it."
      >
        {frameworks.isPending && (
          <ListSkeleton label="Loading frameworks…" rows={3} detail />
        )}
        {frameworks.error && (
          <QueryError
            error={frameworks.error}
            message="Could not load frameworks."
            retry={frameworks.refetch}
            isRetrying={frameworks.isFetching}
          />
        )}
        {frameworks.data && (
          <TemplateRows label="Frameworks">
            {frameworks.data.items.map((framework) => (
              <TemplateRow
                key={framework.id}
                name={framework.name}
                description={framework.description}
                meta={`Framework · revision ${framework.revision}`}
              >
                <Button
                  variant="outline"
                  aria-label={`Duplicate ${framework.name}`}
                  onClick={(event) =>
                    open(event, {
                      type: "duplicate",
                      source: "framework",
                      id: framework.id,
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
      <SettingsSection title="Your templates">
        <Field>
          <FieldLabel htmlFor="template-search">Search templates</FieldLabel>
          <Input
            id="template-search"
            maxLength={200}
            value={query}
            onChange={(event) => search(event.target.value)}
          />
        </Field>
        {templates.isPending && (
          <ListSkeleton label="Loading templates…" rows={3} detail />
        )}
        {templates.error && (
          <QueryError
            error={templates.error}
            message={
              templates.data
                ? "Could not refresh templates. Showing saved results."
                : "Could not load templates."
            }
            retry={templates.refetch}
            isRetrying={templates.isFetching}
          />
        )}
        {templates.data?.total === 0 && (
          <EmptyState
            title={query ? "No matching templates" : "No templates yet"}
            help={query ? undefined : <HelpTopic id="concept.template" />}
            description={
              query
                ? "Try a different name or description."
                : "Duplicate a framework above, or create a template from scratch."
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
                  Create a template
                </Button>
              )
            }
          />
        )}
        {!!templates.data?.items.length && (
          <TemplateRows label="Your templates">
            {templates.data.items.map((template) => (
              <TemplateRow
                key={template.id}
                name={template.name}
                description={template.description}
                meta={`Revision ${template.revision}`}
              >
                <Button
                  variant="outline"
                  aria-label={`Duplicate ${template.name}`}
                  onClick={(event) =>
                    open(event, {
                      type: "duplicate",
                      source: "template",
                      id: template.id,
                    })
                  }
                >
                  Duplicate
                </Button>
                <Button
                  variant="outline"
                  aria-label={`Edit ${template.name}`}
                  onClick={(event) =>
                    open(event, { type: "edit", id: template.id })
                  }
                >
                  Edit
                </Button>
              </TemplateRow>
            ))}
          </TemplateRows>
        )}
        {templates.data && templates.data.total > LIBRARY_PAGE_SIZE && (
          <nav
            aria-label="Template pages"
            className="flex flex-wrap items-center justify-end gap-3"
          >
            <Button
              variant="outline"
              disabled={page === 1 || templates.isFetching}
              onClick={() => setPage(page - 1)}
            >
              Previous templates
            </Button>
            <span>
              Page {page} of {lastPage}
            </span>
            <Button
              variant="outline"
              disabled={page === lastPage || templates.isFetching}
              onClick={() => setPage(page + 1)}
            >
              Next templates
            </Button>
          </nav>
        )}
      </SettingsSection>
      {editing && (
        <TemplateEditorDialog
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

export function TemplateRows({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <ul aria-label={label} className="min-w-0 divide-y border-y">
      {children}
    </ul>
  );
}

export function TemplateRow({
  name,
  description,
  meta,
  children,
}: {
  name: string;
  description: string;
  meta: string;
  children: ReactNode;
}) {
  return (
    <li className="flex min-w-0 flex-wrap items-center justify-between gap-x-4 gap-y-2 py-3">
      <div className="flex min-w-0 flex-1 basis-56 flex-col gap-0.5">
        <p className="font-medium wrap-anywhere">{name}</p>
        <p className="text-muted-foreground text-sm wrap-anywhere">
          {description}
        </p>
        <p className="text-muted-foreground text-xs">{meta}</p>
      </div>
      <div className="flex flex-wrap gap-2">{children}</div>
    </li>
  );
}
