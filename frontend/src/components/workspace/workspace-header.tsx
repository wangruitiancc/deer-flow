"use client";

import { BellIcon, SearchIcon } from "lucide-react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";

import { MatrixLawLogo } from "@/components/brand/matrix-law-logo";
import { Button } from "@/components/ui/button";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { pathOfLawProject, useLawThreadContext } from "@/core/law";
import { cn } from "@/lib/utils";

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
  const tenantId = context.data?.tenant_id ?? query.get("tenant");
  const matterId = context.data?.matter_id ?? query.get("matter");
  return (
    <div
      className={cn(
        "flex h-11 shrink-0 items-center justify-between px-2",
        className,
      )}
    >
      <Link
        href="/workspace/law"
        aria-label="Matrix Law · 法律工作"
        className="min-w-0 flex-1"
      >
        <MatrixLawLogo
          className="flex min-w-0 items-center gap-2 text-sm font-medium [&_img]:shrink-0"
          markSize={20}
          wordmarkClassName="min-w-0 truncate"
        />
      </Link>
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
