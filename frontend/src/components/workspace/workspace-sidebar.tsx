"use client";

import {
  Sidebar,
  SidebarHeader,
  SidebarContent,
} from "@/components/ui/sidebar";

import { LegalProjectTree } from "./law/legal-project-tree";
import { WorkspaceActivityRail } from "./workspace-activity-rail";
import { WorkspaceHeader } from "./workspace-header";

export function WorkspaceSidebar({
  ...props
}: React.ComponentProps<typeof Sidebar>) {
  return (
    <>
      <WorkspaceActivityRail />
      <Sidebar
        variant="sidebar"
        collapsible="offcanvas"
        {...props}
        className="law-navigation-panel"
      >
        <div className="law-workbench bg-sidebar flex h-full min-h-0 flex-col">
          <SidebarHeader className="py-0">
            <WorkspaceHeader />
          </SidebarHeader>
          <SidebarContent>
            <LegalProjectTree />
          </SidebarContent>
        </div>
      </Sidebar>
    </>
  );
}
