"use client";

import {
  Sidebar,
  SidebarHeader,
  SidebarContent,
  SidebarFooter,
} from "@/components/ui/sidebar";

import { LegalProjectTree } from "./law/legal-project-tree";
import { WorkspaceHeader } from "./workspace-header";
import { WorkspaceNavMenu } from "./workspace-nav-menu";

export function WorkspaceSidebar({
  ...props
}: React.ComponentProps<typeof Sidebar>) {
  return (
    <>
      <Sidebar variant="sidebar" collapsible="icon" {...props}>
        <SidebarHeader className="py-0">
          <WorkspaceHeader />
        </SidebarHeader>
        <SidebarContent>
          <LegalProjectTree />
        </SidebarContent>
        <SidebarFooter>
          <WorkspaceNavMenu />
        </SidebarFooter>
      </Sidebar>
    </>
  );
}
