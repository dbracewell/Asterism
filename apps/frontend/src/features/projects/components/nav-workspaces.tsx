"use client";
import { NavListSkeleton } from "@/components/loading-skeletons";
import { PROJECTS_OPEN_COOKIE } from "@/features/dashboard/constants";
import { WorkspaceNavigationRow } from "@/features/dashboard/components/workspace-navigation-row";
import { NavChatSessions } from "@/features/dashboard/components/nav-chat-sessions";
import { QueryError } from "@/components/query-error";
import { Button } from "@/components/ui/button";
import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from "@/components/ui/sidebar";
import { client } from "@/lib/api";
import { projectGetManyOptions } from "@/lib/client/@tanstack/react-query.gen";
import { useQuery } from "@tanstack/react-query";
import cookies from "js-cookie";
import { ChevronDownIcon, ChevronUpIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { useWorkspaceScope } from "../hooks/use-workspace-scope";
const PAGE_SIZE = 5;

export function NavWorkspaces({
  defaultProjectsOpen = false,
  defaultGeneralOpen = false,
}: {
  defaultProjectsOpen?: boolean;
  defaultGeneralOpen?: boolean;
}) {
  const pathname = usePathname();
  const scope = useWorkspaceScope();
  const [isProjectsVisible, setIsProjectVisible] =
    useState(defaultProjectsOpen);
  const [page, setPage] = useState(1);
  const projects = useQuery({
    ...projectGetManyOptions({
      client,
      query: { page, page_size: PAGE_SIZE, sort_by: "created" },
    }),
    retry: false,
  });
  return (
    <SidebarGroup className="group-data-[collapsible=icon]:hidden">
      <SidebarGroupLabel>Workspaces</SidebarGroupLabel>
      <SidebarMenu>
        <SidebarMenuItem>
          <NavChatSessions general defaultIsOpen={defaultGeneralOpen} />
        </SidebarMenuItem>

        <SidebarMenuItem>
          <WorkspaceNavigationRow
            label="Projects"
            href="/projects"
            open={isProjectsVisible}
            active={pathname === "/projects"}
            onToggle={() => {
              cookies.set(PROJECTS_OPEN_COOKIE, String(!isProjectsVisible), {
                path: "/",
                expires: 365,
              });
              setIsProjectVisible(!isProjectsVisible);
            }}
          />
          {isProjectsVisible && (
            <>
              <SidebarMenuSub>
                {projects.data?.projects.map((project) => (
                  <SidebarMenuSubItem key={project.id}>
                    <SidebarMenuSubButton
                      asChild
                      isActive={scope.projectId === project.id}
                    >
                      <Link href={`/projects/${project.id}`}>
                        <span className="truncate">{project.name}</span>
                      </Link>
                    </SidebarMenuSubButton>
                  </SidebarMenuSubItem>
                ))}
                {projects.isPending && (
                  <NavListSkeleton label="Loading workspaces" />
                )}
                {projects.error && (
                  <QueryError
                    error={projects.error}
                    message="Could not refresh workspaces."
                    retry={projects.refetch}
                    isRetrying={projects.isFetching}
                  />
                )}
              </SidebarMenuSub>
              {projects.data &&
                (page > 1 || projects.data.total > PAGE_SIZE) && (
                  <div className="ml-5 flex w-fit items-center justify-between">
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={page === 1 || projects.isFetching}
                      onClick={() => setPage(page - 1)}
                      aria-label="Previous workspace page"
                    >
                      <ChevronUpIcon />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={
                        page * PAGE_SIZE >= projects.data.total ||
                        projects.isFetching
                      }
                      onClick={() => setPage(page + 1)}
                      aria-label="Next workspace page"
                    >
                      <ChevronDownIcon />
                    </Button>
                  </div>
                )}
            </>
          )}
        </SidebarMenuItem>
      </SidebarMenu>
    </SidebarGroup>
  );
}
