"use client";

import { useQueries } from "@tanstack/react-query";
import { LoaderCircleIcon } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { getMatterContextByThread, type Matter } from "@/core/law";
import { useThreads } from "@/core/threads/hooks";
import { pathOfThread, titleOfThread } from "@/core/threads/utils";

// Search supplies display metadata, not message history. Reuse the native list and
// authorization query cache; never persist a second history in browser storage.
const SEARCH = {
  limit: 12,
  sortBy: "updated_at" as const,
  sortOrder: "desc" as const,
  select: ["thread_id", "updated_at", "values", "metadata", "status"] as const,
};

export function RecentLegalConversations({
  tenantId,
  matters,
  activeThreadId,
  focusRequest = 0,
}: {
  tenantId: string;
  matters: readonly Matter[];
  activeThreadId?: string;
  focusRequest?: number;
}) {
  const threads = useThreads({ ...SEARCH, select: [...SEARCH.select] });
  const candidates = threads.data?.slice(0, 12) ?? [];
  const contexts = useQueries({
    queries: candidates.map((thread) => ({
      queryKey: ["law", "thread-context", thread.thread_id],
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        getMatterContextByThread(thread.thread_id, signal),
      retry: false,
    })),
  });
  const [expanded, setExpanded] = useState(false);
  const heading = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!focusRequest) return;
    heading.current?.scrollIntoView?.({ block: "nearest" });
    heading.current?.focus({ preventScroll: true });
  }, [focusRequest]);
  const allowedMatters = new Map(
    matters
      .filter((matter) => matter.status !== "archived")
      .map((matter) => [matter.id, matter]),
  );
  const accessible = threads.isError
    ? []
    : candidates.filter((thread, index) => {
        const context = contexts[index];
        return (
          context?.isSuccess &&
          context.data.thread_id === thread.thread_id &&
          context.data.tenant_id === tenantId &&
          allowedMatters.has(context.data.matter_id)
        );
      });
  const pending =
    threads.isPending || contexts.some((query) => query.isPending);
  return (
    <SidebarGroup className="law-recent-conversations pb-1">
      <SidebarGroupLabel
        ref={heading}
        tabIndex={-1}
        className="focus-visible:ring-ring outline-none focus-visible:ring-1"
      >
        最近会话
      </SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>
          {(expanded ? accessible : accessible.slice(0, 5)).map((thread) => (
            <SidebarMenuItem key={thread.thread_id}>
              <SidebarMenuButton
                asChild
                isActive={thread.thread_id === activeThreadId}
                className="h-[29px] font-normal"
              >
                <Link
                  href={pathOfThread(thread)}
                  title={titleOfThread(thread)}
                  aria-current={
                    thread.thread_id === activeThreadId ? "page" : undefined
                  }
                >
                  <span className="min-w-0 flex-1 truncate">
                    {titleOfThread(thread) === "Untitled"
                      ? "新会话"
                      : titleOfThread(thread)}
                  </span>
                  {thread.status === "busy" && (
                    <LoaderCircleIcon
                      className="size-3 shrink-0 animate-spin"
                      aria-label="正在处理"
                    />
                  )}
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
        {accessible.length === 0 && (
          <p
            className="text-muted-foreground px-2 py-1.5 text-xs"
            role="status"
          >
            {threads.isError
              ? "最近会话暂时不可用"
              : pending
                ? "正在读取最近会话…"
                : "暂无可访问的最近会话"}
          </p>
        )}
        {accessible.length > 5 && (
          <button
            type="button"
            className="law-tree-more"
            aria-expanded={expanded}
            onClick={() => setExpanded((value) => !value)}
          >
            {expanded ? "收起列表" : "展开显示"}
          </button>
        )}
      </SidebarGroupContent>
    </SidebarGroup>
  );
}
