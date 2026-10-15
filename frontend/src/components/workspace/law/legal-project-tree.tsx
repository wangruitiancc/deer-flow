"use client";

import {
  ChevronRightIcon,
  FolderIcon,
  LoaderCircleIcon,
  MoreHorizontalIcon,
  PlusIcon,
  SearchIcon,
  SquarePenIcon,
  Trash2Icon,
} from "lucide-react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarInput,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from "@/components/ui/sidebar";
import { resetThreadChatAfterDelete } from "@/components/workspace/chats/use-thread-chat";
import { useI18n } from "@/core/i18n/hooks";
import {
  useCreateMatterConversation,
  useDetachMatterConversation,
  useLawMatters,
  useLawMatterThreads,
  useLawTenants,
  useLawThreadContext,
  type Matter,
  type MatterKind,
  type MatterThread,
} from "@/core/law";
import {
  collapsedProjectThreads,
  pathOfLawProject,
  pathOfNewLawProject,
  toggleExpandedProject,
  visibleLawProjects,
} from "@/core/law/project-tree";
import { useDeleteThread, useThreadMetadata } from "@/core/threads/hooks";
import { pathOfThread, titleOfThread } from "@/core/threads/utils";
import { cn } from "@/lib/utils";

import { LegalProjectTreeSkeleton } from "./legal-project-tree-skeleton";
import { NewMatterConversationButton } from "./new-matter-conversation-button";

const COPY = {
  "en-US": {
    organization: "Organization",
    projects: "Projects",
    search: "Search legal projects",
    newProject: "New legal project",
    newConversation: "New conversation",
    untitledConversation: "New conversation",
    noProjects: "No legal projects",
    noMatches: "No matching projects",
    noConversations: "No conversations yet",
    loadFailed: "Could not load legal projects.",
    createFailed: "Could not create the conversation.",
    deleteConversation: "Delete conversation",
    removeConversation: "Remove from project",
    deleteDescription:
      "This removes the conversation from the project and permanently deletes its messages and temporary files. Saved project artifacts and versions are retained.",
    removeDescription:
      "This removes the conversation from this project. Data owned by its creator is retained.",
    runningDescription:
      "This conversation still has work in flight. Stop it or wait for it to finish before deleting it.",
    deleteSucceeded: "Conversation deleted.",
    removeSucceeded: "Conversation removed from the project.",
    removeCleanupFailed:
      "The conversation was removed, but its thread data could not be deleted.",
    deleteFailed: "Could not delete the conversation.",
    cancel: "Cancel",
    deleting: "Deleting…",
    retry: "Retry",
    expandProject: "Expand conversations",
    collapseProject: "Collapse conversations",
    showMore: "Show more",
    showLess: "Show less",
    chooseProject: "Choose a legal project",
    chooseProjectDescription:
      "The new conversation will belong to the project you select.",
    running: "Working",
    workKinds: {
      case: "Case",
      consultation: "Consultation",
      contract_review: "Contract review",
      legal_research: "Legal research",
      document_drafting: "Document drafting",
      other_legal: "Other legal work",
    },
  },
  "zh-CN": {
    organization: "组织",
    projects: "项目",
    search: "搜索法律项目",
    newProject: "新建法律项目",
    newConversation: "新建会话",
    untitledConversation: "新会话",
    noProjects: "暂无法律项目",
    noMatches: "没有匹配的项目",
    noConversations: "暂无会话",
    loadFailed: "法律项目加载失败。",
    createFailed: "会话创建失败。",
    deleteConversation: "删除会话",
    removeConversation: "移出项目",
    deleteDescription:
      "会话将从项目中移除，并永久删除其消息和临时文件；已经保存到项目的成果及历史版本会保留。",
    removeDescription:
      "会话将从当前项目中移除；属于会话创建者的数据不会被删除。",
    runningDescription: "会话仍有任务在运行，请先停止或等待任务结束后再删除。",
    deleteSucceeded: "会话已删除。",
    removeSucceeded: "会话已从项目中移除。",
    removeCleanupFailed: "会话已移出项目，但底层会话数据未能删除。",
    deleteFailed: "无法删除会话。",
    cancel: "取消",
    deleting: "正在删除…",
    retry: "重试",
    expandProject: "展开会话列表",
    collapseProject: "折叠会话列表",
    showMore: "展开显示",
    showLess: "收起列表",
    chooseProject: "选择会话所属案件",
    chooseProjectDescription: "新会话会保存在你选择的法律项目中。",
    running: "正在处理",
    workKinds: {
      case: "案件",
      consultation: "法律咨询",
      contract_review: "合同审核",
      legal_research: "法律研究",
      document_drafting: "文书起草",
      other_legal: "其他法律工作",
    },
  },
} as const;

function activeThreadIdOf(value: string | string[] | undefined) {
  return typeof value === "string" ? value : value?.[0];
}

function ConversationLink({
  tenantId,
  matterId,
  mapping,
  activeThreadId,
  currentMembershipId,
  untitledLabel,
  copy,
}: {
  tenantId: string;
  matterId: string;
  mapping: MatterThread;
  activeThreadId: string | undefined;
  currentMembershipId: string | undefined;
  untitledLabel: string;
  copy: (typeof COPY)[keyof typeof COPY];
}) {
  const router = useRouter();
  const threadQuery = useThreadMetadata(mapping.thread_id);
  const detachMutation = useDetachMatterConversation(tenantId, matterId);
  const deleteMutation = useDeleteThread();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const rawTitle = threadQuery.data ? titleOfThread(threadQuery.data) : "";
  const title = rawTitle && rawTitle !== "Untitled" ? rawTitle : untitledLabel;
  const isOwnConversation =
    mapping.created_by_membership_id === currentMembershipId;
  const isRunning = isOwnConversation && threadQuery.data?.status === "busy";
  const isPending = detachMutation.isPending || deleteMutation.isPending;
  const actionLabel = isOwnConversation
    ? copy.deleteConversation
    : copy.removeConversation;
  const canOfferAction =
    currentMembershipId !== undefined &&
    (!isOwnConversation || threadQuery.isSuccess);

  async function removeConversation() {
    try {
      await detachMutation.mutateAsync(mapping);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : copy.deleteFailed);
      return;
    }

    let deleted = false;
    if (isOwnConversation) {
      try {
        await deleteMutation.mutateAsync({ threadId: mapping.thread_id });
        deleted = true;
      } catch {
        toast.error(copy.removeCleanupFailed);
      }
    }

    const projectPath = pathOfLawProject(tenantId, matterId);
    if (mapping.thread_id === activeThreadId) {
      if (deleted) {
        resetThreadChatAfterDelete({
          deletedThreadId: mapping.thread_id,
          nextPath: projectPath,
          force: true,
        });
      }
      router.replace(projectPath);
    }
    if (!isOwnConversation || deleted) {
      toast.success(
        isOwnConversation ? copy.deleteSucceeded : copy.removeSucceeded,
      );
    }
    setConfirmOpen(false);
  }

  return (
    <SidebarMenuSubItem>
      <SidebarMenuSubButton
        asChild
        isActive={mapping.thread_id === activeThreadId}
        title={title}
      >
        <Link className="pr-7" href={pathOfThread(mapping.thread_id)}>
          <span className="min-w-0 flex-1 truncate">{title}</span>
          {threadQuery.data?.status === "busy" && (
            <LoaderCircleIcon
              aria-label={copy.running}
              className="text-muted-foreground size-3 shrink-0 animate-spin"
            />
          )}
        </Link>
      </SidebarMenuSubButton>
      {canOfferAction && (
        <>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground absolute top-1 right-0.5 flex size-5 items-center justify-center rounded-md opacity-0 outline-none group-focus-within/menu-sub-item:opacity-100 group-hover/menu-sub-item:opacity-100 focus-visible:ring-2 data-[state=open]:opacity-100"
                aria-label={`${actionLabel}: ${title}`}
                title={actionLabel}
              >
                <MoreHorizontalIcon className="size-3.5" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent side="right" align="start">
              <DropdownMenuItem
                className="text-destructive focus:text-destructive"
                onSelect={() => setConfirmOpen(true)}
              >
                <Trash2Icon className="text-destructive" />
                {actionLabel}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{actionLabel}</DialogTitle>
                <DialogDescription>
                  {isRunning
                    ? copy.runningDescription
                    : isOwnConversation
                      ? copy.deleteDescription
                      : copy.removeDescription}
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  disabled={isPending}
                  onClick={() => setConfirmOpen(false)}
                >
                  {copy.cancel}
                </Button>
                <Button
                  type="button"
                  variant="destructive"
                  disabled={isPending || isRunning}
                  onClick={() => void removeConversation()}
                >
                  {isPending ? copy.deleting : actionLabel}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </>
      )}
    </SidebarMenuSubItem>
  );
}

function ProjectTreeItem({
  tenantId,
  matter,
  expanded,
  activeMatterId,
  activeThreadId,
  currentMembershipId,
  workKinds,
  copy,
  onToggle,
  onOpenProject,
}: {
  tenantId: string;
  matter: Matter;
  expanded: boolean;
  activeMatterId: string | undefined;
  activeThreadId: string | undefined;
  currentMembershipId: string | undefined;
  workKinds: Record<MatterKind, string>;
  copy: (typeof COPY)[keyof typeof COPY];
  onToggle: () => void;
  onOpenProject: () => void;
}) {
  const router = useRouter();
  const threadsQuery = useLawMatterThreads(
    tenantId,
    expanded ? matter.id : null,
  );
  const conversationMutation = useCreateMatterConversation(tenantId, matter.id);
  const [showAll, setShowAll] = useState(false);
  const activeThreads = threadsQuery.data
    ?.filter((mapping) => mapping.status === "active")
    .sort((left, right) => right.updated_at.localeCompare(left.updated_at));
  const contextLabel = matter.case_number ?? workKinds[matter.kind];
  const visibleThreads = showAll
    ? activeThreads
    : collapsedProjectThreads(activeThreads ?? [], activeThreadId);

  async function createConversation() {
    try {
      const created = await conversationMutation.mutateAsync();
      router.push(pathOfThread(created.threadId));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : copy.createFailed);
    }
  }

  return (
    <SidebarMenuItem>
      <div className="flex min-w-0 items-start gap-0.5">
        <button
          type="button"
          aria-label={`${expanded ? copy.collapseProject : copy.expandProject}: ${matter.title}`}
          aria-expanded={expanded}
          aria-controls={`matter-conversations-${matter.id}`}
          onClick={onToggle}
          className="text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-sidebar-ring mt-1 flex size-7 shrink-0 items-center justify-center rounded-md outline-none focus-visible:ring-2"
        >
          <ChevronRightIcon
            className={cn(
              "size-4 transition-transform",
              expanded && "rotate-90",
            )}
          />
        </button>
        <SidebarMenuButton
          type="button"
          isActive={matter.id === activeMatterId}
          onClick={onOpenProject}
          className="h-8 min-w-0 flex-1 items-center pr-6"
          title={`${matter.title} · ${contextLabel}`}
        >
          <FolderIcon />
          <span className="min-w-0 flex-1">
            <span className="block truncate">{matter.title}</span>
          </span>
        </SidebarMenuButton>
      </div>
      <SidebarMenuAction
        type="button"
        showOnHover
        aria-label={`${copy.newConversation}: ${matter.title}`}
        title={copy.newConversation}
        disabled={conversationMutation.isPending}
        onClick={() => void createConversation()}
      >
        {conversationMutation.isPending ? (
          <LoaderCircleIcon className="animate-spin" />
        ) : (
          <PlusIcon />
        )}
      </SidebarMenuAction>

      {expanded && (
        <SidebarMenuSub id={`matter-conversations-${matter.id}`}>
          {threadsQuery.isPending ? (
            <>
              <LegalProjectTreeSkeleton />
              <LegalProjectTreeSkeleton />
            </>
          ) : threadsQuery.isError ? (
            <SidebarMenuSubItem>
              <button
                type="button"
                className="text-destructive hover:bg-sidebar-accent w-full rounded-md px-2 py-1 text-left text-xs"
                onClick={() => void threadsQuery.refetch()}
              >
                {copy.retry}
              </button>
            </SidebarMenuSubItem>
          ) : !activeThreads?.length ? (
            <SidebarMenuSubItem>
              <span className="text-muted-foreground block px-2 py-1 text-xs">
                {copy.noConversations}
              </span>
            </SidebarMenuSubItem>
          ) : (
            <>
              {visibleThreads?.map((mapping) => (
                <ConversationLink
                  key={mapping.id}
                  tenantId={tenantId}
                  matterId={matter.id}
                  mapping={mapping}
                  activeThreadId={activeThreadId}
                  currentMembershipId={currentMembershipId}
                  untitledLabel={copy.untitledConversation}
                  copy={copy}
                />
              ))}
              {activeThreads.length > 5 && (
                <SidebarMenuSubItem>
                  <button
                    type="button"
                    className="law-tree-more"
                    aria-expanded={showAll}
                    onClick={() => setShowAll((current) => !current)}
                  >
                    {showAll ? copy.showLess : copy.showMore}
                  </button>
                </SidebarMenuSubItem>
              )}
            </>
          )}
        </SidebarMenuSub>
      )}
    </SidebarMenuItem>
  );
}

export function LegalProjectTree({
  searchRequest = 0,
  onSearchHandled,
}: {
  searchRequest?: number;
  onSearchHandled?: () => void;
}) {
  const { locale } = useI18n();
  const copy = COPY[locale];
  const router = useRouter();
  const params = useParams<{ thread_id?: string | string[] }>();
  const searchParams = useSearchParams();
  const activeThreadId = activeThreadIdOf(params.thread_id);
  const routeTenantId = searchParams.get("tenant");
  const routeMatterId = searchParams.get("matter");
  const contextQuery = useLawThreadContext(activeThreadId);
  const tenantsQuery = useLawTenants();
  const [selectedTenantId, setSelectedTenantId] = useState<string | null>(null);
  const [expandedMatterIds, setExpandedMatterIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [searchQuery, setSearchQuery] = useState("");
  const [chooseProjectOpen, setChooseProjectOpen] = useState(false);
  const searchInput = useRef<HTMLInputElement>(null);
  const mattersQuery = useLawMatters(selectedTenantId);
  useEffect(() => {
    if (searchRequest > 0 && searchInput.current) {
      searchInput.current.focus();
      onSearchHandled?.();
    }
  }, [searchRequest, onSearchHandled]);
  useEffect(() => {
    setChooseProjectOpen(false);
    setSearchQuery("");
  }, [selectedTenantId]);

  useEffect(() => {
    const context = contextQuery.data;
    const tenantId = context?.tenant_id ?? routeTenantId;
    const matterId = context?.matter_id ?? routeMatterId;
    if (!tenantId) return;
    setSelectedTenantId(tenantId);
    if (!matterId) return;
    setExpandedMatterIds((current) => {
      if (current.has(matterId)) return current;
      return new Set(current).add(matterId);
    });
  }, [contextQuery.data, routeMatterId, routeTenantId]);

  useEffect(() => {
    const tenants = tenantsQuery.data;
    if (!tenants?.length) {
      setSelectedTenantId(null);
      return;
    }
    if (
      !selectedTenantId ||
      !tenants.some((item) => item.tenant.id === selectedTenantId)
    ) {
      setSelectedTenantId(tenants[0]!.tenant.id);
    }
  }, [selectedTenantId, tenantsQuery.data]);

  const projects = useMemo(
    () => visibleLawProjects(mattersQuery.data ?? [], searchQuery),
    [mattersQuery.data, searchQuery],
  );
  const currentMembershipId = tenantsQuery.data?.find(
    (item) => item.tenant.id === selectedTenantId,
  )?.membership.id;
  const currentMatterId =
    contextQuery.data?.tenant_id === selectedTenantId
      ? contextQuery.data.matter_id
      : routeTenantId === selectedTenantId
        ? routeMatterId
        : null;
  const currentMatter = mattersQuery.data?.find(
    (matter) => matter.id === currentMatterId && matter.status !== "archived",
  );

  return (
    <>
      <div className="law-navigation-actions">
        {currentMatter && selectedTenantId ? (
          <NewMatterConversationButton
            key={`${selectedTenantId}:${currentMatter.id}`}
            tenantId={selectedTenantId}
            matterId={currentMatter.id}
            label={copy.newConversation}
            title={`${copy.newConversation} · ${currentMatter.title}`}
          />
        ) : (
          <button
            type="button"
            className="law-new-conversation"
            onClick={() => setChooseProjectOpen(true)}
            disabled={
              tenantsQuery.isPending ||
              mattersQuery.isPending ||
              !selectedTenantId
            }
          >
            <SquarePenIcon className="size-4" strokeWidth={1.6} />
            <span>{copy.newConversation}</span>
          </button>
        )}
      </div>
      <Dialog open={chooseProjectOpen} onOpenChange={setChooseProjectOpen}>
        <DialogContent className="law-workbench sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{copy.chooseProject}</DialogTitle>
            <DialogDescription>
              {copy.chooseProjectDescription}
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-72 overflow-y-auto">
            {selectedTenantId &&
              visibleLawProjects(mattersQuery.data ?? [], "").map((matter) => (
                <NewMatterConversationButton
                  key={`${selectedTenantId}:${matter.id}`}
                  tenantId={selectedTenantId}
                  matterId={matter.id}
                  label={matter.title}
                  onCreated={() => setChooseProjectOpen(false)}
                />
              ))}
            {visibleLawProjects(mattersQuery.data ?? [], "").length === 0 && (
              <Link
                href={pathOfNewLawProject(selectedTenantId)}
                className="law-new-conversation"
                onClick={() => setChooseProjectOpen(false)}
              >
                <PlusIcon className="size-4" />
                {copy.newProject}
              </Link>
            )}
          </div>
        </DialogContent>
      </Dialog>
      <SidebarGroup className="pb-0 group-data-[collapsible=icon]:hidden">
        <SidebarGroupLabel>{copy.organization}</SidebarGroupLabel>
        <SidebarGroupContent className="space-y-2 px-1">
          <Select
            value={selectedTenantId ?? ""}
            onValueChange={(value) => {
              setSelectedTenantId(value);
              setExpandedMatterIds(new Set());
              router.push(`/workspace/law?tenant=${encodeURIComponent(value)}`);
            }}
            disabled={!tenantsQuery.data?.length}
          >
            <SelectTrigger
              className="bg-sidebar-accent/40 h-8 w-full border-0 shadow-none"
              aria-label={copy.organization}
            >
              <SelectValue placeholder={copy.organization} />
            </SelectTrigger>
            <SelectContent>
              {tenantsQuery.data?.map((item) => (
                <SelectItem key={item.tenant.id} value={item.tenant.id}>
                  {item.tenant.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="relative">
            <SearchIcon className="text-muted-foreground pointer-events-none absolute top-2 left-2 size-4" />
            <SidebarInput
              ref={searchInput}
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder={copy.search}
              aria-label={copy.search}
              className="pl-8"
            />
          </div>
        </SidebarGroupContent>
      </SidebarGroup>

      <SidebarGroup className="min-h-0 flex-1 pt-1 group-data-[collapsible=icon]:hidden">
        <SidebarGroupLabel>{copy.projects}</SidebarGroupLabel>
        <SidebarGroupAction asChild title={copy.newProject}>
          <Link
            href={pathOfNewLawProject(selectedTenantId)}
            aria-label={copy.newProject}
          >
            <PlusIcon />
          </Link>
        </SidebarGroupAction>
        <SidebarGroupContent>
          <SidebarMenu>
            {tenantsQuery.isPending || mattersQuery.isPending ? (
              <>
                <LegalProjectTreeSkeleton showIcon />
                <LegalProjectTreeSkeleton showIcon />
                <LegalProjectTreeSkeleton showIcon />
              </>
            ) : tenantsQuery.isError || mattersQuery.isError ? (
              <SidebarMenuItem>
                <button
                  type="button"
                  className="text-destructive hover:bg-sidebar-accent w-full rounded-md px-2 py-2 text-left text-xs"
                  onClick={() => {
                    void tenantsQuery.refetch();
                    void mattersQuery.refetch();
                  }}
                >
                  {copy.loadFailed} {copy.retry}
                </button>
              </SidebarMenuItem>
            ) : projects.length === 0 ? (
              <SidebarMenuItem>
                <div className="text-muted-foreground px-2 py-3 text-xs">
                  {searchQuery ? copy.noMatches : copy.noProjects}
                </div>
              </SidebarMenuItem>
            ) : (
              projects.map((matter) => (
                <ProjectTreeItem
                  key={matter.id}
                  tenantId={matter.tenant_id}
                  matter={matter}
                  expanded={expandedMatterIds.has(matter.id)}
                  activeMatterId={
                    contextQuery.data?.matter_id ?? routeMatterId ?? undefined
                  }
                  activeThreadId={activeThreadId}
                  currentMembershipId={currentMembershipId}
                  workKinds={copy.workKinds}
                  copy={copy}
                  onToggle={() =>
                    setExpandedMatterIds((current) =>
                      toggleExpandedProject(current, matter.id),
                    )
                  }
                  onOpenProject={() =>
                    router.push(pathOfLawProject(matter.tenant_id, matter.id))
                  }
                />
              ))
            )}
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>
    </>
  );
}
