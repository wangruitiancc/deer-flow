"use client";

import {
  Building2Icon,
  FolderOpenIcon,
  GaugeIcon,
  HomeIcon,
  SearchIcon,
  Settings2Icon,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { Button } from "@/components/ui/button";
import { SidebarTrigger, useSidebar } from "@/components/ui/sidebar";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useLawTenants } from "@/core/law";
import { cn } from "@/lib/utils";

import { useSettingsDialog } from "./settings";
import { WorkspaceNavMenu } from "./workspace-nav-menu";

export function WorkspaceActivityRail({ onSearch }: { onSearch?: () => void }) {
  const { open, openMobile, isMobile, setOpen, setOpenMobile } = useSidebar();
  const expanded = isMobile ? openMobile : open;
  const pathname = usePathname();
  const { openSettings } = useSettingsDialog();
  const tenants = useLawTenants();
  const canManage = tenants.data?.some((item) =>
    ["owner", "admin"].includes(item.membership.role),
  );
  const capability = pathname.startsWith("/workspace/law/capabilities");
  const toggleLabel = expanded ? "收起案件侧栏" : "展开案件侧栏";
  const links = [
    {
      href: "/workspace/law",
      label: "法律工作",
      icon: HomeIcon,
      active: pathname === "/workspace/law" && !capability,
    },
    {
      href: "/workspace/law/capabilities",
      label: "我的能力与用量",
      icon: GaugeIcon,
      active: capability,
    },
    ...(canManage
      ? [
          {
            href: "/law-admin/",
            label: "律所管理后台",
            icon: Building2Icon,
            active: false,
          },
        ]
      : []),
  ];
  return (
    <nav aria-label="工作区快捷导航" className="law-activity-rail">
      <div className="flex h-11 shrink-0 items-center justify-center">
        <Tooltip>
          <TooltipTrigger asChild>
            <SidebarTrigger
              className="size-8 opacity-100"
              aria-label={toggleLabel}
              title={toggleLabel}
              aria-expanded={expanded}
            />
          </TooltipTrigger>
          <TooltipContent side="right">{toggleLabel}</TooltipContent>
        </Tooltip>
      </div>
      <div role="group" aria-label="工作区入口" className="law-rail-group">
        {links.slice(0, 1).map(({ href, label, icon: Icon, active }) => (
          <Tooltip key={href}>
            <TooltipTrigger asChild>
              <Button
                asChild
                variant="ghost"
                size="icon"
                className={cn(
                  "text-muted-foreground size-9 rounded-lg",
                  active && "bg-sidebar-accent text-sidebar-accent-foreground",
                )}
              >
                <Link
                  href={href}
                  aria-label={label}
                  aria-current={active ? "page" : undefined}
                >
                  <Icon className="size-[18px]" strokeWidth={1.7} />
                </Link>
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">{label}</TooltipContent>
          </Tooltip>
        ))}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className={cn(
                "text-muted-foreground size-9 rounded-lg",
                expanded && "bg-sidebar-accent text-sidebar-accent-foreground",
              )}
              aria-label="案件与会话"
              aria-expanded={expanded}
              onClick={() => {
                if (isMobile) setOpenMobile(true);
                else setOpen(true);
              }}
            >
              <FolderOpenIcon className="size-[18px]" strokeWidth={1.7} />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right">案件与会话</TooltipContent>
        </Tooltip>
        {onSearch && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="text-muted-foreground size-9 rounded-lg"
                aria-label="展开并搜索案件"
                onClick={onSearch}
              >
                <SearchIcon className="size-[18px]" strokeWidth={1.7} />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">搜索案件</TooltipContent>
          </Tooltip>
        )}
      </div>
      <div role="separator" className="law-rail-divider" />
      <div role="group" aria-label="能力与管理" className="law-rail-group">
        {links.slice(1).map(({ href, label, icon: Icon, active }) => (
          <Tooltip key={href}>
            <TooltipTrigger asChild>
              <Button
                asChild
                variant="ghost"
                size="icon"
                className={cn(
                  "text-muted-foreground size-9 rounded-lg",
                  active && "bg-sidebar-accent text-sidebar-accent-foreground",
                )}
              >
                <Link
                  href={href}
                  aria-label={label}
                  aria-current={active ? "page" : undefined}
                >
                  <Icon className="size-[18px]" strokeWidth={1.7} />
                </Link>
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">{label}</TooltipContent>
          </Tooltip>
        ))}
      </div>
      <div className="mt-auto flex flex-col items-center gap-2 pb-2">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="text-muted-foreground size-9"
              aria-label="设置"
              onClick={() => openSettings("appearance")}
            >
              <Settings2Icon className="size-[18px]" strokeWidth={1.7} />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right">设置</TooltipContent>
        </Tooltip>
        <WorkspaceNavMenu compact />
      </div>
    </nav>
  );
}
