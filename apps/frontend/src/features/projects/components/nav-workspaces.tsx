"use client";
import { QueryError } from "@/components/query-error";
import { Button } from "@/components/ui/button";
import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
} from "@/components/ui/sidebar";
import { Spinner } from "@/components/ui/spinner";
import { client } from "@/lib/api";
import { projectGetManyOptions } from "@/lib/client/@tanstack/react-query.gen";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { useWorkspaceScope } from "../hooks/use-workspace-scope";

export function NavWorkspaces() {
  const pathname = usePathname();
  const scope = useWorkspaceScope();
  const [page, setPage] = useState(1);
  const projects = useQuery({
    ...projectGetManyOptions({
      client,
      query: { page, page_size: 5, sort_by: "name" },
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
          <SidebarMenuButton asChild isActive={pathname === "/projects"}>
            <Link href="/projects">Projects</Link>
          </SidebarMenuButton>
        </SidebarMenuItem>
        {projects.data?.projects.map((project) => (
          <SidebarMenuItem key={project.id}>
            <SidebarMenuButton
              asChild
              isActive={scope.projectId === project.id}
            >
              <Link href={`/projects/${project.id}`}>
                <span className="truncate">{project.name}</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        ))}
      </SidebarMenu>
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
      {projects.data && (page > 1 || projects.data.total > 5) && (
        <div className="flex justify-between gap-2 pt-2">
          <Button
            size="sm"
            variant="ghost"
            disabled={page === 1 || projects.isFetching}
            onClick={() => setPage(page - 1)}
            aria-label="Previous workspace page"
          >
            Previous
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={page * 5 >= projects.data.total || projects.isFetching}
            onClick={() => setPage(page + 1)}
            aria-label="Next workspace page"
          >
            Next
          </Button>
        </div>
      )}
    </SidebarGroup>
  );
}
