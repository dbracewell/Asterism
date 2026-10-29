"use client";

import { Badge } from "@/components/ui/badge";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Skeleton } from "@/components/ui/skeleton";
import { useUser } from "@/features/auth/components/user-context";
import { ChatSessionActionMenu } from "@/features/dashboard/components/chat-session-action-menu";
import { personaQueryOptions } from "@/features/settings/persona-queries";
import { client } from "@/lib/api";
import type { ChatInfo } from "@/lib/client";
import {
  chatSessionGetOneOptions,
  projectGetOneOptions,
} from "@/lib/client/@tanstack/react-query.gen";
import { cn } from "@/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { CpuIcon, UserRoundIcon } from "lucide-react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Fragment, type ReactNode } from "react";

export type HeaderRoute =
  | { kind: "chat"; chatId: string; file: boolean }
  | { kind: "new-chat"; projectId: string | null }
  | { kind: "project"; projectId: string; settings: boolean }
  | { kind: "page"; trail: { label: string; href?: string }[] };

const PAGE_TITLES: Record<string, string> = {
  "/general": "General",
  "/projects": "Projects",
  "/search": "Search",
  "/files": "Files",
  "/settings": "Settings",
};

/** Maps a dashboard pathname onto the header's breadcrumb shape. */
export function headerRoute(
  pathname: string,
  projectParam: string | null,
): HeaderRoute {
  const chat = pathname.match(/^\/c\/([^/]+)(\/files\/[^/]+)?/);
  if (chat) return { kind: "chat", chatId: chat[1], file: !!chat[2] };
  if (pathname === "/") return { kind: "new-chat", projectId: projectParam };
  const project = pathname.match(/^\/projects\/([^/]+)(\/settings)?/);
  if (project)
    return { kind: "project", projectId: project[1], settings: !!project[2] };
  const file = pathname.match(/^\/files\/([^/]+)/);
  if (file)
    return {
      kind: "page",
      trail: [
        { label: "Files", href: "/files" },
        { label: decodeURIComponent(file[1]) },
      ],
    };
  const title = PAGE_TITLES[pathname];
  return { kind: "page", trail: title ? [{ label: title }] : [] };
}

/** The single dashboard header: sidebar toggle, location and chat context. */
export const AppHeader = () => {
  const pathname = usePathname();
  const search = useSearchParams();
  const route = headerRoute(pathname, search.get("project_id"));
  return (
    <HeaderBar>
      {route.kind === "chat" ? (
        <ChatHeaderContent
          key={route.chatId}
          chatId={route.chatId}
          file={route.file}
        />
      ) : (
        <HeaderBreadcrumb
          crumbs={
            route.kind === "new-chat"
              ? [workspaceCrumb(route.projectId), { label: "New chat" }]
              : route.kind === "project"
                ? [
                    { label: "Projects", href: "/projects" },
                    {
                      label: <ProjectName projectId={route.projectId} />,
                      href: route.settings
                        ? `/projects/${route.projectId}`
                        : undefined,
                    },
                    ...(route.settings ? [{ label: "Settings" }] : []),
                  ]
                : route.trail
          }
        />
      )}
    </HeaderBar>
  );
};

export function HeaderBar({ children }: { children: ReactNode }) {
  return (
    <header
      data-slot="app-header"
      className="bg-background sticky top-0 z-10 flex h-12 w-full min-w-0 shrink-0 items-center gap-1 border-b pr-1 md:gap-2 md:px-3"
    >
      <SidebarTrigger className="size-11!" />
      {children}
    </header>
  );
}

/** Breadcrumb, chips and actions for one saved chat. */
export function ChatHeaderContent({
  chatId,
  file = false,
}: {
  chatId: string;
  file?: boolean;
}) {
  const chat = useQuery({
    ...chatSessionGetOneOptions({ client, path: { chat_id: chatId } }),
    retry: false,
  });
  if (chat.isPending)
    return (
      <Skeleton
        aria-label="Loading chat"
        role="status"
        className="h-4 w-40 max-w-full"
      />
    );
  if (!chat.data) return <HeaderBreadcrumb crumbs={[{ label: "Chat" }]} />;
  const info = chat.data.info;
  const title = info.title || "Untitled chat";
  return (
    <>
      <HeaderBreadcrumb
        crumbs={[
          workspaceCrumb(info.project_id ?? null),
          { label: title, href: file ? `/c/${info.id}` : undefined },
          ...(file ? [{ label: "File" }] : []),
        ]}
      />
      <ChatChips info={info} />
      <ChatSessionActionMenu chat={info} variant="header" />
    </>
  );
}

function ChatChips({ info }: { info: ChatInfo }) {
  const user = useUser();
  const personas = useQuery(personaQueryOptions(user.id));
  const personaId = info.persona_id ?? personas.data?.default_persona_id;
  const persona = personas.data?.profiles.find(({ id }) => id === personaId);
  const model = info.selected_model;
  if (!model && !persona) return null;
  return (
    <ul
      aria-label="Chat configuration"
      className="hidden min-w-0 shrink items-center gap-1 md:flex"
    >
      {model && (
        <li className="min-w-0">
          <Badge
            variant={model.available ? "secondary" : "destructive"}
            className="h-6 max-w-48 text-xs"
            title={
              model.available
                ? `${model.name} · ${model.provider_name}`
                : (model.unavailable_reason ?? `${model.name} is unavailable`)
            }
          >
            <CpuIcon aria-hidden="true" />
            <span className="sr-only">Model: </span>
            <span className="truncate">{model.name}</span>
            {!model.available && (
              <span className="sr-only"> (unavailable)</span>
            )}
          </Badge>
        </li>
      )}
      {persona && (
        <li className="min-w-0">
          <Badge variant="outline" className="h-6 max-w-40 text-xs">
            <UserRoundIcon aria-hidden="true" />
            <span className="sr-only">Persona: </span>
            <span className="truncate">{persona.name}</span>
          </Badge>
        </li>
      )}
    </ul>
  );
}

type Crumb = { label: ReactNode; href?: string };

function workspaceCrumb(projectId: string | null): Crumb {
  return projectId
    ? {
        label: <ProjectName projectId={projectId} />,
        href: `/projects/${projectId}`,
      }
    : { label: "General", href: "/general" };
}

function ProjectName({ projectId }: { projectId: string }) {
  const project = useQuery({
    ...projectGetOneOptions({ client, path: { project_id: projectId } }),
    retry: false,
  });
  return (
    project.data?.name ??
    (project.isPending ? "Loading project…" : "Project unavailable")
  );
}

/** Earlier crumbs drop out on narrow screens so the current page keeps room. */
function HeaderBreadcrumb({ crumbs }: { crumbs: Crumb[] }) {
  return (
    <Breadcrumb className="min-w-0 flex-1">
      <BreadcrumbList className="flex-nowrap text-sm">
        {crumbs.map((crumb, index) => {
          const last = index === crumbs.length - 1;
          const ancestor = cn("min-w-0", !last && "hidden sm:inline-flex");
          return (
            <Fragment key={index}>
              {index > 0 && <BreadcrumbSeparator className="hidden sm:block" />}
              <BreadcrumbItem className={ancestor}>
                {crumb.href ? (
                  <BreadcrumbLink asChild className="truncate">
                    <Link href={crumb.href}>{crumb.label}</Link>
                  </BreadcrumbLink>
                ) : (
                  <BreadcrumbPage className="truncate font-medium">
                    {crumb.label}
                  </BreadcrumbPage>
                )}
              </BreadcrumbItem>
            </Fragment>
          );
        })}
      </BreadcrumbList>
    </Breadcrumb>
  );
}
