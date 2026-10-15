"use client";

import Link from "next/link";

import { MatrixLawLogo } from "@/components/brand/matrix-law-logo";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";

export function WorkspaceHeader({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "flex h-11 shrink-0 items-center justify-between px-2",
        className,
      )}
    >
      <Link href="/workspace/law" aria-label="Matrix Law · 法律工作">
        <MatrixLawLogo
          className="flex items-center gap-2 text-sm font-medium"
          markSize={20}
        />
      </Link>
      <SidebarTrigger
        className="opacity-100 md:hidden"
        aria-label="关闭案件侧栏"
        title="关闭案件侧栏"
      />
    </div>
  );
}
