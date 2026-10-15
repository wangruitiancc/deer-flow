"use client";

import { useState } from "react";

import {
  Sidebar,
  SidebarHeader,
  SidebarContent,
  useSidebar,
} from "@/components/ui/sidebar";

import { LegalProjectTree } from "./law/legal-project-tree";
import { WorkspaceActivityRail } from "./workspace-activity-rail";
import { WorkspaceHeader } from "./workspace-header";

export function WorkspaceSidebar({
  ...props
}: React.ComponentProps<typeof Sidebar>) {
  const { isMobile, setOpen, setOpenMobile } = useSidebar();
  const [searchRequest, setSearchRequest] = useState(0);
  const searchProjects = () => {
    if (isMobile) setOpenMobile(true);
    else setOpen(true);
    setSearchRequest((value) => value + 1);
  };
  return (
    <>
      <WorkspaceActivityRail onSearch={searchProjects} />
      <Sidebar
        variant="sidebar"
        collapsible="offcanvas"
        {...props}
        className="law-navigation-panel"
      >
        <div className="law-workbench law-tree-panel bg-sidebar flex h-full min-h-0 flex-col">
          <SidebarHeader className="py-0">
            <WorkspaceHeader onSearch={searchProjects} />
          </SidebarHeader>
          <SidebarContent>
            <LegalProjectTree
              searchRequest={searchRequest}
              onSearchHandled={() => setSearchRequest(0)}
            />
          </SidebarContent>
        </div>
      </Sidebar>
    </>
  );
}
