"use client";

import {
  BellIcon,
  Building2Icon,
  ChevronDownIcon,
  GaugeIcon,
  HomeIcon,
  SearchIcon,
  Settings2Icon,
} from "lucide-react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";

import { MatrixLawLogo } from "@/components/brand/matrix-law-logo";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SidebarTrigger } from "@/components/ui/sidebar";
import {
  pathOfLawProject,
  useLawTenants,
  useLawThreadContext,
} from "@/core/law";
import { cn } from "@/lib/utils";

import { useSettingsDialog } from "./settings";

export function WorkspaceHeader({
  className,
  onSearch,
}: {
  className?: string;
  onSearch?: () => void;
}) {
  const params = useParams<{ thread_id?: string }>();
  const query = useSearchParams();
  const context = useLawThreadContext(params.thread_id);
  const tenants = useLawTenants();
  const { openSettings } = useSettingsDialog();
  const canManage = tenants.data?.some((item) =>
    ["owner", "admin"].includes(item.membership.role),
  );
  const tenantId = context.data?.tenant_id ?? query.get("tenant");
  const matterId = context.data?.matter_id ?? query.get("matter");
  return (
    <div
      className={cn(
        "flex h-11 shrink-0 items-center justify-between px-2",
        className,
      )}
    >
      <div className="flex min-w-0 flex-1 items-center gap-0.5">
        <Link
          href="/workspace/law"
          aria-label="Matrix Law · 法律工作"
          className="min-w-0"
        >
          <MatrixLawLogo
            className="flex min-w-0 items-center gap-2 text-sm font-medium [&_img]:shrink-0"
            markSize={20}
            wordmarkClassName="min-w-0 truncate"
          />
        </Link>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="text-muted-foreground size-5 shrink-0"
              aria-label="工作区菜单"
              title="工作区菜单"
            >
              <ChevronDownIcon className="size-3" strokeWidth={1.6} />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="law-workbench min-w-52 rounded-lg"
            align="start"
            sideOffset={10}
          >
            <DropdownMenuItem asChild>
              <Link href="/workspace/law">
                <HomeIcon />
                法律工作
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link href="/workspace/law/capabilities">
                <GaugeIcon />
                我的能力与用量
              </Link>
            </DropdownMenuItem>
            {canManage && (
              <DropdownMenuItem asChild>
                <Link href="/law-admin/">
                  <Building2Icon />
                  律所管理后台
                </Link>
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => openSettings("appearance")}>
              <Settings2Icon />
              设置与外观
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <div className="flex shrink-0 items-center gap-0.5">
        {tenantId && matterId && (
          <Button
            asChild
            variant="ghost"
            size="icon"
            className="text-muted-foreground size-7"
          >
            <Link
              href={`${pathOfLawProject(tenantId, matterId)}&view=schedule`}
              aria-label="案件提醒与日程"
              title="案件提醒与日程"
            >
              <BellIcon className="size-3.5" strokeWidth={1.6} />
            </Link>
          </Button>
        )}
        <Button
          variant="ghost"
          size="icon"
          className="text-muted-foreground size-7"
          aria-label="搜索法律项目"
          title="搜索法律项目"
          onClick={onSearch}
        >
          <SearchIcon className="size-3.5" strokeWidth={1.6} />
        </Button>
        <SidebarTrigger
          className="opacity-100 md:hidden"
          aria-label="关闭案件侧栏"
          title="关闭案件侧栏"
        />
      </div>
    </div>
  );
}
