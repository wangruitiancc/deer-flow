"use client";

import {
  ChevronsUpDown,
  InfoIcon,
  Settings2Icon,
  GaugeIcon,
  LogOutIcon,
  CircleHelpIcon,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { toast } from "sonner";

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
  const initials = label.includes("@")
    ? label.split("@")[0]!.slice(0, 2).toUpperCase()
    : label.slice(0, 1);
  return (
    <div
      className={`flex w-full items-center gap-2.5 text-left ${isSidebarOpen ? "" : "justify-center"}`}
    >
      <span
        aria-hidden="true"
        className="bg-primary/15 text-primary flex size-7 shrink-0 items-center justify-center rounded-full text-[10px] font-medium"
      >
        {initials}
      </span>
      {isSidebarOpen && (
        <>
          <span className="min-w-0 flex-1 truncate text-xs">{label}</span>
          <ChevronsUpDown className="text-muted-foreground size-3.5 shrink-0" />
        </>
      )}
    </div>
  );
}
export function WorkspaceNavMenu({ compact = false }: { compact?: boolean }) {
  const { openSettings } = useSettingsDialog();
  const [mounted, setMounted] = useState(false);
  const { open: isSidebarOpen } = useSidebar();
  const { user, logout } = useAuth();
  const [logoutPending, setLogoutPending] = useState(false);
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
                  className={
                    compact
                      ? "data-[state=open]:bg-sidebar-accent size-9 justify-center p-0"
                      : "data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
                  }
                >
                  <NavMenuButtonContent
                    isSidebarOpen={!compact && isSidebarOpen}
                    label={navMenuLabel}
                  />
                </SidebarMenuButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                className="law-workbench w-(--radix-dropdown-menu-trigger-width) min-w-56 rounded-lg"
                align="end"
                side={compact ? "right" : "bottom"}
                sideOffset={8}
              >
                <div className="border-b px-3 py-3">
                  <p className="truncate text-xs font-medium">{navMenuLabel}</p>
                  <p className="text-muted-foreground mt-1 text-[11px]">
                    Matrix Law · 当前登录账号
                  </p>
                </div>
                <DropdownMenuGroup>
                  <DropdownMenuItem asChild>
                    <Link href="/workspace/law/capabilities">
                      <GaugeIcon />
                      我的能力与用量
                    </Link>
                  </DropdownMenuItem>
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
                  <DropdownMenuItem onClick={() => openSettings("account")}>
                    <CircleHelpIcon />
                    账号与登录
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    disabled={logoutPending}
                    onSelect={() => {
                      setLogoutPending(true);
                      void logout()
                        .catch(() => toast.error("退出登录失败，请重试。"))
                        .finally(() => setLogoutPending(false));
                    }}
                  >
                    <LogOutIcon />
                    {logoutPending ? "正在退出…" : "退出登录"}
                  </DropdownMenuItem>
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <SidebarMenuButton
              size="lg"
              aria-label={`${navMenuLabel} · ${t.workspace.settingsAndMore}`}
              className={
                compact
                  ? "pointer-events-none size-9 p-0"
                  : "pointer-events-none"
              }
            >
              <NavMenuButtonContent
                isSidebarOpen={!compact && isSidebarOpen}
                label={navMenuLabel}
              />
            </SidebarMenuButton>
          )}
        </SidebarMenuItem>
      </SidebarMenu>
    </>
  );
}
