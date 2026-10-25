"use client";
import { QueryError } from "@/components/query-error";
import { Button } from "@/components/ui/button";
import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  sidebarMenuButtonVariants,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from "@/components/ui/sidebar";
import { Spinner } from "@/components/ui/spinner";
import { client } from "@/lib/api";
import { projectGetManyOptions } from "@/lib/client/@tanstack/react-query.gen";
import { useQuery } from "@tanstack/react-query";
import cookies from "js-cookie";
import { ChevronDownIcon, ChevronRightIcon, ChevronUpIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { useWorkspaceScope } from "../hooks/use-workspace-scope";
const PAGE_SIZE = 5;

export function NavWorkspaces() {
  const pathname = usePathname();
  const scope = useWorkspaceScope();
  const [isProjectsVisible, setIsProjectVisible] = useState(
    cookies.get("is_project_visible") === "true",
  );
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
          <SidebarMenuButton
            asChild
            isActive={
              !scope.pending &&
              !scope.error &&
              !scope.projectId &&
              (pathname === "/general" ||
                pathname === "/" ||
                pathname.startsWith("/c/"))
            }
          >
            <Link href="/general">General</Link>
          </SidebarMenuButton>
        </SidebarMenuItem>

        <SidebarMenuItem>
          <div
            className={sidebarMenuButtonVariants({
              className: "flex items-center",
            })}
            data-active={pathname === "/projects"}
          >
            <button
              className="[&_>svg]:size-3!"
              onClick={() => {
                cookies.set("is_project_visible", String(!isProjectsVisible));
                setIsProjectVisible(!isProjectsVisible);
              }}
            >
              {isProjectsVisible ? <ChevronDownIcon /> : <ChevronRightIcon />}
            </button>
            <SidebarMenuButton
              className="pl-0!"
              asChild
              isActive={pathname === "/projects"}
            >
              <Link href="/projects">Projects</Link>
            </SidebarMenuButton>
          </div>
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
                  <div role="status" aria-label="Loading workspaces">
                    <Spinner size={24} />
                  </div>
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
                (page > 1 || page <= projects.data.total / 5) && (
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
                        page * 5 >= projects.data.total || projects.isFetching
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
