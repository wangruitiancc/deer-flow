"use client";

import {
  ChevronsUpDown,
  InfoIcon,
  Settings2Icon,
  SettingsIcon,
} from "lucide-react";
import { useEffect, useState } from "react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { useAuth } from "@/core/auth/AuthProvider";
import { useI18n } from "@/core/i18n/hooks";

import { useSettingsDialog } from "./settings";

function NavMenuButtonContent({
  isSidebarOpen,
  label,
}: {
  isSidebarOpen: boolean;
  label: string;
}) {
  return isSidebarOpen ? (
    <div className="text-muted-foreground flex w-full items-center gap-2 text-left text-sm">
      <SettingsIcon className="size-4" />
      <span className="truncate">{label}</span>
      <ChevronsUpDown className="text-muted-foreground ml-auto size-4" />
    </div>
  ) : (
    <div className="flex size-full items-center justify-center">
      <SettingsIcon className="text-muted-foreground size-4" />
    </div>
  );
}
export function WorkspaceNavMenu() {
  const { openSettings } = useSettingsDialog();
  const [mounted, setMounted] = useState(false);
  const { open: isSidebarOpen } = useSidebar();
  const { user } = useAuth();
  const { t } = useI18n();
  const navMenuLabel = user?.email ?? t.workspace.settingsAndMore;

  useEffect(() => {
    setMounted(true);
  }, []);

  return (
    <>
      <SidebarMenu className="w-full">
        <SidebarMenuItem>
          {mounted ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <SidebarMenuButton
                  size="lg"
                  aria-label={`${navMenuLabel} · ${t.workspace.settingsAndMore}`}
                  className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
                >
                  <NavMenuButtonContent
                    isSidebarOpen={isSidebarOpen}
                    label={navMenuLabel}
                  />
                </SidebarMenuButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                className="w-(--radix-dropdown-menu-trigger-width) min-w-56 rounded-lg"
                align="end"
                sideOffset={4}
              >
                <DropdownMenuGroup>
                  <DropdownMenuItem
                    onClick={() => {
                      openSettings("appearance");
                    }}
                  >
                    <Settings2Icon />
                    {t.common.settings}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onClick={() => {
                      openSettings("about");
                    }}
                  >
                    <InfoIcon />
                    {t.workspace.about}
                  </DropdownMenuItem>
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <SidebarMenuButton
              size="lg"
              aria-label={`${navMenuLabel} · ${t.workspace.settingsAndMore}`}
              className="pointer-events-none"
            >
              <NavMenuButtonContent
                isSidebarOpen={isSidebarOpen}
                label={navMenuLabel}
              />
            </SidebarMenuButton>
          )}
        </SidebarMenuItem>
      </SidebarMenu>
    </>
  );
}
