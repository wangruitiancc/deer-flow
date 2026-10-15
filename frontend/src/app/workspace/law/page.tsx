"use client";

import {
  ArrowRightIcon,
  BriefcaseBusinessIcon,
  Building2Icon,
  LoaderCircleIcon,
  MessageSquarePlusIcon,
  PlusIcon,
  RefreshCwIcon,
  ShieldCheckIcon,
  UsersIcon,
  UserRoundPlusIcon,
  CheckIcon,
  UserRoundMinusIcon,
} from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { MatterDeadlinePanel } from "@/components/workspace/law/matter-deadline-panel";
import {
  WorkspaceBody,
  WorkspaceContainer,
  WorkspaceHeader,
} from "@/components/workspace/workspace-container";
import { useI18n } from "@/core/i18n/hooks";
import {
  useCreateLawMatter,
  useCreateMatterConversation,
  createMatterConversation,
  useLawMatter,
  useLawMatterMembers,
  useLawMatterMemberCandidates,
  useCreateLawMatterMember,
  useUpdateLawMatterMember,
  useLawMatters,
  useLawMatterThreads,
  useLawTenants,
  pathOfLawProject,
  type MatterClassification,
  type MatterKind,
  type MatterStage,
  type MatterMemberRole,
  type MatterMemberStatus,
} from "@/core/law";
import { pathOfThread } from "@/core/threads/utils";
import { cn } from "@/lib/utils";

function WorkProductLoading() {
  const { t } = useI18n();
  return (
    <p role="status" className="text-muted-foreground py-4 text-xs">
      {t.common.loading}
    </p>
  );
}

const MatterOverviewDashboard = dynamic(
  () =>
    import("@/components/workspace/law/matter-overview-dashboard").then(
      (module) => module.MatterOverviewDashboard,
    ),
  { loading: WorkProductLoading },
);
const MatterLegalHoldPanel = dynamic(
  () =>
    import("@/components/workspace/law/matter-legal-hold-panel").then(
      (module) => module.MatterLegalHoldPanel,
    ),
  { loading: WorkProductLoading },
);

const MatterCaseAnalysisPanel = dynamic(
  () =>
    import("@/components/workspace/law/matter-structured-work-product-panel").then(
      (module) => module.MatterCaseAnalysisPanel,
    ),
  { loading: WorkProductLoading },
);
const MatterLitigationStrategyPanel = dynamic(
  () =>
    import("@/components/workspace/law/matter-structured-work-product-panel").then(
      (module) => module.MatterLitigationStrategyPanel,
    ),
  { loading: WorkProductLoading },
);
const MatterProposalReviewPanel = dynamic(
  () =>
    import("@/components/workspace/law/matter-structured-work-product-panel").then(
      (module) => module.MatterProposalReviewPanel,
    ),
  { loading: WorkProductLoading },
);
const MatterWorkProductList = dynamic(
  () =>
    import("@/components/workspace/law/matter-structured-work-product-panel").then(
      (module) => module.MatterWorkProductList,
    ),
  { loading: WorkProductLoading },
);

const COPY = {
  "en-US": {
    title: "Legal work",
    subtitle:
      "Cases, one-off consultations, contract reviews and other legal work. Every run remains tenant-scoped and access-controlled.",
    workspace: "Legal workspace",
    createWorkspace: "Activate law firm",
    workspaceName: "Activation code",
    workspaceSlug: "",
    ownerName: "",
    workspaceHelp:
      "The code is issued once by the capability platform after approval.",
    createWorkspaceTitle: "Activate approved law firm",
    createWorkspaceDescription:
      "Only a capability-platform-approved code can create a legal workspace. The signed-in owner email must match the registration.",
    matters: "Legal work items",
    createMatter: "New legal work",
    createMatterTitle: "Start legal work",
    createMatterDescription:
      "Choose the legal-work type. Only a case requires a case number; one-off work opens directly as a legal conversation.",
    workKind: "Work type",
    caseNumber: "Case number",
    matterTitle: "Title",
    cause: "Question, background or objective (optional)",
    stage: "Stage",
    classification: "Classification",
    noWorkspaces: "No legal workspace yet",
    noWorkspacesHint:
      "Ask the capability-platform operator for the approved activation code.",
    noMatters: "No visible legal work",
    noMattersHint:
      "Start a case or a one-off legal task, or ask its owner to add you as an active member.",
    selectMatter: "Select legal work",
    selectMatterHint:
      "Choose an item on the left to view its members, materials and conversations.",
    overview: "Legal-work overview",
    members: "Authorized members",
    conversations: "Legal conversations",
    newConversation: "New conversation",
    openConversation: "Open conversation",
    noMembers: "No members are visible.",
    noConversations: "No conversation has been bound to this legal work item.",
    memberId: "Membership",
    addMember: "Grant case access",
    chooseMember: "Select a firm member",
    caseRole: "Case role",
    saveAccess: "Save access",
    removeAccess: "Remove access",
    restoreAccess: "Restore access",
    noEligibleMembers: "No eligible firm members are available.",
    memberManagementHint:
      "Only active firm members can be granted case access. Removing access immediately revokes case access.",
    updated: "Updated",
    role: "Role",
    status: "Status",
    retry: "Retry",
    loading: "Loading…",
    creating: "Creating…",
    create: "Create and start",
    cancel: "Cancel",
    requestFailed: "The request failed. Please try again.",
    conversationBoundary:
      "Every conversation is bound to this tenant-scoped legal work item before it opens. The page never grants access by itself.",
    workKinds: {
      case: "Case",
      consultation: "One-off consultation",
      contract_review: "Contract review",
      legal_research: "Legal research",
      document_drafting: "Document drafting",
      other_legal: "Other legal work",
    },
    stages: {
      intake: "Intake",
      analysis: "Analysis",
      drafting: "Drafting",
      litigation: "Litigation",
      closed: "Closed",
    },
    classifications: {
      normal: "Normal",
      sensitive: "Sensitive",
      highly_sensitive: "Highly sensitive",
    },
    roles: {
      owner: "Owner",
      lead: "Lead",
      lawyer: "Lawyer",
      assistant: "Assistant",
      viewer: "Viewer",
    },
  },
  "zh-CN": {
    title: "法律工作",
    subtitle:
      "支持案件、单次咨询、合同审核和其他零散法律任务；每次运行仍按租户隔离并重新校验权限。",
    workspace: "法律工作区",
    createWorkspace: "激活律所",
    workspaceName: "律所激活码",
    workspaceSlug: "",
    ownerName: "",
    workspaceHelp: "激活码由能力平台审核律所后一次性签发。",
    createWorkspaceTitle: "激活已审核律所",
    createWorkspaceDescription:
      "只有能力平台审核后的激活码可以创建律所；当前登录邮箱必须与登记负责人一致。",
    matters: "法律事项",
    createMatter: "新建法律事项",
    createMatterTitle: "开始一项法律工作",
    createMatterDescription:
      "先选择工作类型。只有正式案件需要案号；单次咨询、合同审核等可直接进入法律对话。",
    workKind: "工作类型",
    caseNumber: "案号",
    matterTitle: "标题",
    cause: "问题、背景或工作目标（可选）",
    stage: "阶段",
    classification: "敏感级别",
    noWorkspaces: "还没有法律工作区",
    noWorkspacesHint: "请向能力平台运营人员获取审核通过后的律所激活码。",
    noMatters: "暂无可见法律事项",
    noMattersHint:
      "可以新建案件或零散法律任务，也可以请事项所有者将你加入为有效成员。",
    selectMatter: "请选择法律事项",
    selectMatterHint: "从左侧选择后，可以查看成员、材料和法律对话。",
    overview: "法律事项概览",
    members: "授权成员",
    conversations: "法律对话",
    newConversation: "新建对话",
    openConversation: "进入对话",
    noMembers: "暂无可见成员。",
    noConversations: "这个法律事项还没有绑定对话。",
    memberId: "成员标识",
    addMember: "添加案件成员",
    chooseMember: "选择律所成员",
    caseRole: "案件角色",
    saveAccess: "保存授权",
    removeAccess: "撤销访问",
    restoreAccess: "恢复访问",
    noEligibleMembers: "当前没有可加入的律所成员。",
    memberManagementHint:
      "只能授权有效律所成员；撤销后会立即失去案件访问权限。",
    updated: "更新时间",
    role: "角色",
    status: "状态",
    retry: "重试",
    loading: "正在加载…",
    creating: "正在创建…",
    create: "创建并开始",
    cancel: "取消",
    requestFailed: "请求失败，请重试。",
    conversationBoundary:
      "每个对话都会先在服务端绑定到当前租户的法律事项再打开，页面本身不会授予权限。",
    workKinds: {
      case: "正式案件",
      consultation: "单次法律咨询",
      contract_review: "合同审核",
      legal_research: "法律检索与研究",
      document_drafting: "法律文书起草",
      other_legal: "其他法律工作",
    },
    stages: {
      intake: "收案",
      analysis: "分析",
      drafting: "起草",
      litigation: "诉讼",
      closed: "结案",
    },
    classifications: {
      normal: "普通",
      sensitive: "敏感",
      highly_sensitive: "高度敏感",
    },
    roles: {
      owner: "所有者",
      lead: "负责人",
      lawyer: "律师",
      assistant: "助理",
      viewer: "查看者",
    },
  },
} as const;

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function shortId(value: string): string {
  return value.length > 14 ? `${value.slice(0, 8)}…${value.slice(-4)}` : value;
}

function formatDate(value: string, locale: "en-US" | "zh-CN"): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export default function LawMattersPage() {
  const { locale, t } = useI18n();
  const copy = COPY[locale];
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestedTenantId = searchParams.get("tenant");
  const requestedMatterId = searchParams.get("matter");
  const requestedCreation = searchParams.get("new");
  const requestedView = searchParams.get("view");
  const workbenchView = [
    "overview",
    "analysis",
    "strategy",
    "documents",
    "schedule",
  ].includes(requestedView ?? "")
    ? requestedView!
    : "overview";
  const tenantsQuery = useLawTenants();
  const [selectedTenantId, setSelectedTenantId] = useState<string | null>(null);
  const [selectedMatterId, setSelectedMatterId] = useState<string | null>(null);
  const [matterDialogOpen, setMatterDialogOpen] = useState(false);
  const [newMatterMemberId, setNewMatterMemberId] = useState("");
  const [newMatterMemberRole, setNewMatterMemberRole] =
    useState<MatterMemberRole>("lawyer");
  const [editedMatterMemberRoles, setEditedMatterMemberRoles] = useState<
    Record<string, MatterMemberRole>
  >({});
  const createMemberAttempt = useRef<{ signature: string; key: string } | null>(
    null,
  );
  const updateMemberAttempts = useRef(
    new Map<string, { signature: string; key: string }>(),
  );
  const mattersQuery = useLawMatters(selectedTenantId);
  const matterQuery = useLawMatter(selectedTenantId, selectedMatterId);
  const membersQuery = useLawMatterMembers(selectedTenantId, selectedMatterId);
  const threadsQuery = useLawMatterThreads(selectedTenantId, selectedMatterId);
  const conversationMutation = useCreateMatterConversation(
    selectedTenantId,
    selectedMatterId,
  );

  useEffect(() => {
    document.title = `${t.pages.lawMatters} - ${t.pages.appName}`;
  }, [t.pages.appName, t.pages.lawMatters]);

  useEffect(() => {
    const tenants = tenantsQuery.data;
    if (!tenants?.length) {
      setSelectedTenantId(null);
      return;
    }
    const requestedTenant = requestedTenantId
      ? tenants.find((item) => item.tenant.id === requestedTenantId)
      : undefined;
    if (requestedTenant) {
      setSelectedTenantId(requestedTenant.tenant.id);
    } else if (
      !selectedTenantId ||
      !tenants.some((item) => item.tenant.id === selectedTenantId)
    ) {
      setSelectedTenantId(tenants[0]!.tenant.id);
    }
  }, [requestedTenantId, selectedTenantId, tenantsQuery.data]);

  useEffect(() => {
    const matters = mattersQuery.data;
    if (!matters) {
      return;
    }
    if (!matters.length) {
      setSelectedMatterId(null);
      return;
    }
    const requestedMatter = requestedMatterId
      ? matters.find((matter) => matter.id === requestedMatterId)
      : undefined;
    if (requestedMatter) {
      setSelectedMatterId(requestedMatter.id);
      return;
    }
    if (requestedMatterId) {
      setSelectedMatterId(null);
      return;
    }
    if (
      !selectedMatterId ||
      !matters.some((matter) => matter.id === selectedMatterId)
    ) {
      setSelectedMatterId(matters[0]!.id);
    }
  }, [mattersQuery.data, requestedMatterId, selectedMatterId]);

  useEffect(() => {
    if (requestedCreation === "workspace") {
      window.location.replace("/law-admin/");
    }
    if (requestedCreation === "project" && selectedTenantId) {
      setMatterDialogOpen(true);
    }
  }, [requestedCreation, selectedTenantId]);

  useEffect(() => {
    if (
      !selectedTenantId ||
      !selectedMatterId ||
      requestedCreation ||
      requestedMatterId
    )
      return;
    if (
      requestedTenantId !== selectedTenantId ||
      requestedMatterId !== selectedMatterId
    ) {
      router.replace(pathOfLawProject(selectedTenantId, selectedMatterId));
    }
  }, [
    requestedCreation,
    requestedMatterId,
    requestedTenantId,
    router,
    selectedMatterId,
    selectedTenantId,
  ]);

  const selectedTenant = tenantsQuery.data?.find(
    (item) => item.tenant.id === selectedTenantId,
  );
  const matter = matterQuery.data;
  const currentMatterMember = membersQuery.data?.find(
    (member) => member.membership_id === selectedTenant?.membership.id,
  );
  const canManageMatterMembers =
    currentMatterMember?.status === "active" &&
    (currentMatterMember.role === "owner" ||
      currentMatterMember.role === "lead");
  const memberCandidatesQuery = useLawMatterMemberCandidates(
    selectedTenantId,
    selectedMatterId,
    canManageMatterMembers,
  );
  const createMatterMemberMutation = useCreateLawMatterMember(
    selectedTenantId,
    selectedMatterId,
  );
  const updateMatterMemberMutation = useUpdateLawMatterMember(
    selectedTenantId,
    selectedMatterId,
  );

  async function createConversation() {
    if (!selectedTenantId || !selectedMatterId) return;
    const created = await conversationMutation.mutateAsync();
    router.push(pathOfThread(created.threadId));
  }

  async function grantMatterAccess() {
    if (!newMatterMemberId || !selectedTenantId || !selectedMatterId) return;
    const signature = `${newMatterMemberId}:${newMatterMemberRole}`;
    if (createMemberAttempt.current?.signature !== signature) {
      createMemberAttempt.current = {
        signature,
        key: globalThis.crypto.randomUUID(),
      };
    }
    try {
      await createMatterMemberMutation.mutateAsync({
        input: {
          membership_id: newMatterMemberId,
          role: newMatterMemberRole,
        },
        idempotencyKey: createMemberAttempt.current.key,
      });
      createMemberAttempt.current = null;
      setNewMatterMemberId("");
    } catch {
      // Keep the idempotency key so a retry of the same form action replays safely.
    }
  }

  async function setMatterMemberAccess(
    memberId: string,
    role: MatterMemberRole,
    status: MatterMemberStatus,
    version: number,
  ) {
    if (!selectedTenantId || !selectedMatterId) return;
    const signature = `${memberId}:${role}:${status}:${version}`;
    const previous = updateMemberAttempts.current.get(memberId);
    const attempt =
      previous?.signature === signature
        ? previous
        : { signature, key: globalThis.crypto.randomUUID() };
    updateMemberAttempts.current.set(memberId, attempt);
    try {
      await updateMatterMemberMutation.mutateAsync({
        memberId,
        input: { role, status, expected_version: version },
        idempotencyKey: attempt.key,
      });
      updateMemberAttempts.current.delete(memberId);
      setEditedMatterMemberRoles((current) => {
        const next = { ...current };
        delete next[memberId];
        return next;
      });
    } catch {
      // Keep the idempotency key so a retry of the same row action replays safely.
    }
  }

  function selectWorkbenchView(view: string) {
    if (!selectedTenantId || !selectedMatterId) return;
    const params = new URLSearchParams(searchParams.toString());
    params.set("tenant", selectedTenantId);
    params.set("matter", selectedMatterId);
    params.set("view", view);
    params.delete("new");
    router.replace(`/workspace/law?${params.toString()}`, { scroll: false });
  }

  return (
    <WorkspaceContainer>
      <WorkspaceHeader />
      <WorkspaceBody className="overflow-hidden">
        <div className="flex size-full flex-col overflow-hidden">
          <div className="border-b px-4 py-5 sm:px-6">
            <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
              <div className="max-w-3xl">
                <div className="flex items-center gap-2">
                  <ShieldCheckIcon className="text-primary size-5" />
                  <h1 className="text-2xl font-semibold tracking-tight">
                    {copy.title}
                  </h1>
                </div>
                <p className="text-muted-foreground mt-2 text-sm leading-6">
                  {copy.subtitle}
                </p>
              </div>
              <div className="flex w-full flex-col gap-2 sm:flex-row lg:w-auto lg:items-center">
                {selectedTenant && (
                  <Badge variant="outline" className="h-9 px-3">
                    <Building2Icon />
                    {selectedTenant.tenant.name}
                  </Badge>
                )}
                <Button
                  variant="outline"
                  onClick={() => window.location.assign("/law-admin/")}
                >
                  <PlusIcon />
                  {copy.createWorkspace}
                </Button>
                <Button
                  onClick={() => setMatterDialogOpen(true)}
                  disabled={!selectedTenantId}
                >
                  <PlusIcon />
                  {copy.createMatter}
                </Button>
              </div>
            </div>
          </div>

          <ScrollArea className="min-h-0 flex-1">
            <div className="mx-auto w-full max-w-7xl p-4 sm:p-6">
              {tenantsQuery.isPending ? (
                <PageSkeleton />
              ) : tenantsQuery.isError ? (
                <ErrorState
                  message={errorMessage(tenantsQuery.error, copy.requestFailed)}
                  retry={copy.retry}
                  onRetry={() => void tenantsQuery.refetch()}
                />
              ) : !tenantsQuery.data?.length ? (
                <EmptyState
                  icon={<Building2Icon className="size-8" />}
                  title={copy.noWorkspaces}
                  description={copy.noWorkspacesHint}
                  action={copy.createWorkspace}
                  onAction={() => window.location.assign("/law-admin/")}
                />
              ) : (
                <div className="space-y-5">
                  {!selectedMatterId ? (
                    <EmptyState
                      icon={<BriefcaseBusinessIcon className="size-8" />}
                      title={copy.selectMatter}
                      description={copy.selectMatterHint}
                    />
                  ) : matterQuery.isPending ? (
                    <PageSkeleton />
                  ) : matterQuery.isError || !matter ? (
                    <ErrorState
                      message={errorMessage(
                        matterQuery.error,
                        copy.requestFailed,
                      )}
                      retry={copy.retry}
                      onRetry={() => void matterQuery.refetch()}
                    />
                  ) : (
                    <div className="space-y-5">
                      <Card>
                        <CardHeader>
                          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                            <div className="min-w-0">
                              <div className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
                                {matter.case_number ??
                                  copy.workKinds[matter.kind]}
                              </div>
                              <CardTitle className="mt-1 text-xl">
                                {matter.title}
                              </CardTitle>
                              {matter.cause && (
                                <p className="text-muted-foreground mt-2 text-sm">
                                  {matter.cause}
                                </p>
                              )}
                            </div>
                            <div className="flex flex-wrap gap-2">
                              <Badge>{copy.stages[matter.stage]}</Badge>
                              <Badge variant="secondary">
                                {copy.workKinds[matter.kind]}
                              </Badge>
                              <Badge variant="outline">
                                {copy.classifications[matter.classification]}
                              </Badge>
                              <Badge variant="secondary">{matter.status}</Badge>
                            </div>
                          </div>
                        </CardHeader>
                        <CardContent>
                          <div className="text-muted-foreground flex flex-wrap gap-x-6 gap-y-2 text-xs">
                            <span>
                              {copy.updated}:{" "}
                              {formatDate(matter.updated_at, locale)}
                            </span>
                            <span>Tenant: {shortId(matter.tenant_id)}</span>
                            <span>Matter: {shortId(matter.id)}</span>
                          </div>
                        </CardContent>
                      </Card>

                      <Tabs
                        value={workbenchView}
                        onValueChange={selectWorkbenchView}
                      >
                        <TabsList className="h-auto w-full flex-wrap justify-start">
                          <TabsTrigger value="overview">
                            {locale === "zh-CN" ? "总览" : "Overview"}
                          </TabsTrigger>
                          <TabsTrigger value="analysis">
                            {locale === "zh-CN"
                              ? "案情与证据"
                              : "Facts and evidence"}
                          </TabsTrigger>
                          <TabsTrigger value="strategy">
                            {locale === "zh-CN" ? "诉讼策略" : "Strategy"}
                          </TabsTrigger>
                          <TabsTrigger value="documents">
                            {locale === "zh-CN" ? "文书与成果" : "Documents"}
                          </TabsTrigger>
                          <TabsTrigger value="schedule">
                            {locale === "zh-CN" ? "日程" : "Schedule"}
                          </TabsTrigger>
                        </TabsList>
                        <TabsContent value="overview" className="mt-4">
                          <MatterOverviewDashboard
                            matter={matter}
                            view="overview"
                          />
                        </TabsContent>
                        <TabsContent value="analysis" className="mt-4">
                          <div className="space-y-4">
                            <MatterCaseAnalysisPanel
                              tenantId={matter.tenant_id}
                              matterId={matter.id}
                              locale={locale}
                            />
                            <MatterProposalReviewPanel
                              tenantId={matter.tenant_id}
                              matterId={matter.id}
                              kind="case_analysis"
                              locale={locale}
                            />
                          </div>
                        </TabsContent>
                        <TabsContent value="strategy" className="mt-4">
                          <div className="space-y-4">
                            <MatterLitigationStrategyPanel
                              tenantId={matter.tenant_id}
                              matterId={matter.id}
                              locale={locale}
                            />
                            <MatterProposalReviewPanel
                              tenantId={matter.tenant_id}
                              matterId={matter.id}
                              kind="litigation_strategy"
                              locale={locale}
                            />
                          </div>
                        </TabsContent>
                        <TabsContent
                          value="documents"
                          className="mt-4 space-y-4"
                        >
                          <MatterWorkProductList
                            tenantId={matter.tenant_id}
                            matterId={matter.id}
                            locale={locale}
                          />
                          <Card>
                            <CardHeader>
                              <CardTitle className="text-base">
                                {locale === "zh-CN"
                                  ? "材料与办案对话"
                                  : "Materials and case conversations"}
                              </CardTitle>
                            </CardHeader>
                            <CardContent className="flex flex-wrap items-center justify-between gap-3">
                              <p className="text-muted-foreground text-sm">
                                {locale === "zh-CN"
                                  ? "在对话中使用案件材料、模板和受管法律工具，生成结果须经律师核对后保存和审核。"
                                  : "Use matter materials, templates and managed legal tools in a conversation; review generated work before saving and approval."}
                              </p>
                              <Button
                                disabled={
                                  threadsQuery.isPending ||
                                  threadsQuery.isError ||
                                  conversationMutation.isPending
                                }
                                onClick={() => {
                                  const thread = threadsQuery.data?.[0];
                                  if (thread)
                                    router.push(pathOfThread(thread.thread_id));
                                  else void createConversation();
                                }}
                              >
                                {locale === "zh-CN"
                                  ? "打开文书工作区"
                                  : "Open document workspace"}
                                <ArrowRightIcon />
                              </Button>
                            </CardContent>
                          </Card>
                        </TabsContent>
                        <TabsContent value="schedule" className="mt-4">
                          <MatterOverviewDashboard
                            matter={matter}
                            view="schedule"
                          />
                          {currentMatterMember?.status === "active" &&
                            selectedTenant?.membership.id && (
                              <MatterDeadlinePanel
                                tenantId={matter.tenant_id}
                                matterId={matter.id}
                                matterRole={currentMatterMember.role}
                                currentMembershipId={
                                  selectedTenant.membership.id
                                }
                              />
                            )}
                        </TabsContent>
                      </Tabs>

                      <MatterLegalHoldPanel
                        tenantId={matter.tenant_id}
                        matterId={matter.id}
                        matterStatus={matter.status}
                        matterVersion={matter.version}
                        canManage={
                          currentMatterMember?.status === "active" &&
                          (currentMatterMember.role === "owner" ||
                            currentMatterMember.role === "lead")
                        }
                      />

                      <div className="grid gap-5 xl:grid-cols-2">
                        <Card>
                          <CardHeader className="flex-row items-center gap-2">
                            <UsersIcon className="text-muted-foreground size-4" />
                            <CardTitle className="text-base">
                              {copy.members}
                            </CardTitle>
                          </CardHeader>
                          <CardContent>
                            {canManageMatterMembers && (
                              <div className="mb-4 space-y-3 rounded-md border p-3">
                                <div className="flex items-center gap-2 text-sm font-medium">
                                  <UserRoundPlusIcon className="size-4" />
                                  {copy.addMember}
                                </div>
                                <p className="text-muted-foreground text-xs leading-5">
                                  {copy.memberManagementHint}
                                </p>
                                <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(8rem,0.7fr)_auto]">
                                  <Select
                                    value={newMatterMemberId}
                                    onValueChange={setNewMatterMemberId}
                                    disabled={
                                      memberCandidatesQuery.isPending ||
                                      createMatterMemberMutation.isPending
                                    }
                                  >
                                    <SelectTrigger
                                      aria-label={copy.chooseMember}
                                    >
                                      <SelectValue
                                        placeholder={copy.chooseMember}
                                      />
                                    </SelectTrigger>
                                    <SelectContent>
                                      {(memberCandidatesQuery.data ?? []).map(
                                        (candidate) => (
                                          <SelectItem
                                            key={candidate.membership_id}
                                            value={candidate.membership_id}
                                          >
                                            {candidate.display_name ??
                                              `${copy.memberId} ${shortId(candidate.membership_id)}`}{" "}
                                            · {candidate.tenant_role}
                                          </SelectItem>
                                        ),
                                      )}
                                    </SelectContent>
                                  </Select>
                                  <Select
                                    value={newMatterMemberRole}
                                    onValueChange={(value) =>
                                      setNewMatterMemberRole(
                                        value as MatterMemberRole,
                                      )
                                    }
                                    disabled={
                                      createMatterMemberMutation.isPending
                                    }
                                  >
                                    <SelectTrigger aria-label={copy.caseRole}>
                                      <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                      {(
                                        [
                                          "lead",
                                          "lawyer",
                                          "assistant",
                                          "viewer",
                                        ] as MatterMemberRole[]
                                      )
                                        .concat(
                                          currentMatterMember.role === "owner"
                                            ? ["owner"]
                                            : [],
                                        )
                                        .map((role) => (
                                          <SelectItem key={role} value={role}>
                                            {copy.roles[role]}
                                          </SelectItem>
                                        ))}
                                    </SelectContent>
                                  </Select>
                                  <Button
                                    onClick={() => void grantMatterAccess()}
                                    disabled={
                                      !newMatterMemberId ||
                                      createMatterMemberMutation.isPending
                                    }
                                  >
                                    {createMatterMemberMutation.isPending ? (
                                      <LoaderCircleIcon className="animate-spin" />
                                    ) : (
                                      <UserRoundPlusIcon />
                                    )}
                                    {copy.addMember}
                                  </Button>
                                </div>
                                {memberCandidatesQuery.isError && (
                                  <p
                                    role="alert"
                                    className="text-destructive text-sm"
                                  >
                                    {errorMessage(
                                      memberCandidatesQuery.error,
                                      copy.requestFailed,
                                    )}
                                  </p>
                                )}
                                {!memberCandidatesQuery.isPending &&
                                  !memberCandidatesQuery.isError &&
                                  !memberCandidatesQuery.data?.length && (
                                    <p className="text-muted-foreground text-xs">
                                      {copy.noEligibleMembers}
                                    </p>
                                  )}
                                {createMatterMemberMutation.isError && (
                                  <p
                                    role="alert"
                                    className="text-destructive text-sm"
                                  >
                                    {errorMessage(
                                      createMatterMemberMutation.error,
                                      copy.requestFailed,
                                    )}
                                  </p>
                                )}
                              </div>
                            )}
                            {updateMatterMemberMutation.isError && (
                              <p
                                role="alert"
                                className="text-destructive mb-3 text-sm"
                              >
                                {errorMessage(
                                  updateMatterMemberMutation.error,
                                  copy.requestFailed,
                                )}
                              </p>
                            )}
                            {membersQuery.isPending ? (
                              <Skeleton className="h-24 w-full" />
                            ) : membersQuery.isError ? (
                              <ErrorState
                                compact
                                message={errorMessage(
                                  membersQuery.error,
                                  copy.requestFailed,
                                )}
                                retry={copy.retry}
                                onRetry={() => void membersQuery.refetch()}
                              />
                            ) : !membersQuery.data?.length ? (
                              <p className="text-muted-foreground text-sm">
                                {copy.noMembers}
                              </p>
                            ) : (
                              <div className="divide-y">
                                {membersQuery.data.map((member) => (
                                  <div
                                    key={member.id}
                                    className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0"
                                  >
                                    <div className="min-w-0 flex-1">
                                      <div className="text-sm font-medium">
                                        {copy.roles[member.role]}
                                      </div>
                                      <div
                                        className="text-muted-foreground truncate text-xs"
                                        title={member.membership_id}
                                      >
                                        {copy.memberId}:{" "}
                                        {shortId(member.membership_id)}
                                      </div>
                                    </div>
                                    <div className="flex flex-wrap items-center justify-end gap-2">
                                      {canManageMatterMembers &&
                                      (member.role !== "owner" ||
                                        currentMatterMember.role ===
                                          "owner") ? (
                                        <>
                                          <Select
                                            value={
                                              editedMatterMemberRoles[
                                                member.id
                                              ] ?? member.role
                                            }
                                            onValueChange={(value) =>
                                              setEditedMatterMemberRoles(
                                                (current) => ({
                                                  ...current,
                                                  [member.id]:
                                                    value as MatterMemberRole,
                                                }),
                                              )
                                            }
                                            disabled={
                                              updateMatterMemberMutation.isPending ||
                                              member.status === "removed"
                                            }
                                          >
                                            <SelectTrigger
                                              aria-label={`${copy.caseRole}: ${shortId(member.membership_id)}`}
                                              className="w-36"
                                            >
                                              <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent>
                                              {(
                                                [
                                                  "lead",
                                                  "lawyer",
                                                  "assistant",
                                                  "viewer",
                                                ] as MatterMemberRole[]
                                              )
                                                .concat(
                                                  currentMatterMember.role ===
                                                    "owner"
                                                    ? ["owner"]
                                                    : [],
                                                )
                                                .map((role) => (
                                                  <SelectItem
                                                    key={role}
                                                    value={role}
                                                  >
                                                    {copy.roles[role]}
                                                  </SelectItem>
                                                ))}
                                            </SelectContent>
                                          </Select>
                                          <Button
                                            size="sm"
                                            variant="outline"
                                            disabled={
                                              updateMatterMemberMutation.isPending ||
                                              (editedMatterMemberRoles[
                                                member.id
                                              ] ?? member.role) === member.role
                                            }
                                            onClick={() =>
                                              void setMatterMemberAccess(
                                                member.id,
                                                editedMatterMemberRoles[
                                                  member.id
                                                ] ?? member.role,
                                                member.status,
                                                member.version,
                                              )
                                            }
                                          >
                                            <CheckIcon />
                                            {copy.saveAccess}
                                          </Button>
                                          <Button
                                            size="sm"
                                            variant="outline"
                                            disabled={
                                              updateMatterMemberMutation.isPending
                                            }
                                            onClick={() =>
                                              void setMatterMemberAccess(
                                                member.id,
                                                editedMatterMemberRoles[
                                                  member.id
                                                ] ?? member.role,
                                                member.status === "active"
                                                  ? "removed"
                                                  : "active",
                                                member.version,
                                              )
                                            }
                                          >
                                            {member.status === "active" ? (
                                              <UserRoundMinusIcon />
                                            ) : (
                                              <UserRoundPlusIcon />
                                            )}
                                            {member.status === "active"
                                              ? copy.removeAccess
                                              : copy.restoreAccess}
                                          </Button>
                                        </>
                                      ) : (
                                        <Badge
                                          variant={
                                            member.status === "active"
                                              ? "secondary"
                                              : "outline"
                                          }
                                        >
                                          {member.status}
                                        </Badge>
                                      )}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}
                          </CardContent>
                        </Card>

                        <Card>
                          <CardHeader className="flex-row items-center justify-between gap-3">
                            <div className="flex items-center gap-2">
                              <MessageSquarePlusIcon className="text-muted-foreground size-4" />
                              <CardTitle className="text-base">
                                {copy.conversations}
                              </CardTitle>
                            </div>
                            <Button
                              size="sm"
                              onClick={() => void createConversation()}
                              disabled={conversationMutation.isPending}
                            >
                              {conversationMutation.isPending ? (
                                <LoaderCircleIcon className="animate-spin" />
                              ) : (
                                <PlusIcon />
                              )}
                              {conversationMutation.isPending
                                ? copy.creating
                                : copy.newConversation}
                            </Button>
                          </CardHeader>
                          <CardContent>
                            <p className="text-muted-foreground mb-3 text-xs leading-5">
                              {copy.conversationBoundary}
                            </p>
                            {conversationMutation.isError && (
                              <p
                                role="alert"
                                className="text-destructive mb-3 text-sm"
                              >
                                {errorMessage(
                                  conversationMutation.error,
                                  copy.requestFailed,
                                )}
                              </p>
                            )}
                            {threadsQuery.isPending ? (
                              <Skeleton className="h-24 w-full" />
                            ) : threadsQuery.isError ? (
                              <ErrorState
                                compact
                                message={errorMessage(
                                  threadsQuery.error,
                                  copy.requestFailed,
                                )}
                                retry={copy.retry}
                                onRetry={() => void threadsQuery.refetch()}
                              />
                            ) : !threadsQuery.data?.length ? (
                              <p className="text-muted-foreground text-sm">
                                {copy.noConversations}
                              </p>
                            ) : (
                              <div className="space-y-2">
                                {threadsQuery.data.map((mapping) => (
                                  <Button
                                    key={mapping.id}
                                    asChild
                                    variant="outline"
                                    className="w-full justify-between"
                                  >
                                    <Link
                                      href={pathOfThread(mapping.thread_id)}
                                    >
                                      <span className="truncate">
                                        {copy.openConversation} ·{" "}
                                        {shortId(mapping.thread_id)}
                                      </span>
                                      <ArrowRightIcon />
                                    </Link>
                                  </Button>
                                ))}
                              </div>
                            )}
                          </CardContent>
                        </Card>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </ScrollArea>
        </div>
      </WorkspaceBody>

      <CreateMatterDialog
        open={matterDialogOpen}
        onOpenChange={(open) => {
          setMatterDialogOpen(open);
          if (!open && requestedCreation) {
            router.replace(
              selectedTenantId
                ? `/workspace/law?tenant=${encodeURIComponent(selectedTenantId)}`
                : "/workspace/law",
            );
          }
        }}
        tenantId={selectedTenantId}
        copy={copy}
        onCreated={(matterId, threadId) => {
          setSelectedMatterId(matterId);
          router.push(pathOfThread(threadId));
        }}
      />
    </WorkspaceContainer>
  );
}

type Copy = (typeof COPY)[keyof typeof COPY];

function CreateMatterDialog({
  open,
  onOpenChange,
  tenantId,
  copy,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tenantId: string | null;
  copy: Copy;
  onCreated: (matterId: string, threadId: string) => void;
}) {
  const mutation = useCreateLawMatter(tenantId);
  const [startError, setStartError] = useState<unknown>(null);
  const [isStarting, setIsStarting] = useState(false);
  const [kind, setKind] = useState<MatterKind>("consultation");
  const [caseNumber, setCaseNumber] = useState("");
  const [title, setTitle] = useState("");
  const [cause, setCause] = useState("");
  const [stage, setStage] = useState<MatterStage>("intake");
  const [classification, setClassification] =
    useState<MatterClassification>("normal");

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!tenantId) return;
    setStartError(null);
    setIsStarting(true);
    try {
      const created = await mutation.mutateAsync({
        kind,
        ...(kind === "case" ? { case_number: caseNumber.trim() } : {}),
        title: title.trim(),
        ...(cause.trim() ? { cause: cause.trim() } : {}),
        stage,
        classification,
      });
      const conversation = await createMatterConversation(tenantId, created.id);
      setKind("consultation");
      setCaseNumber("");
      setTitle("");
      setCause("");
      setStage("intake");
      setClassification("normal");
      onOpenChange(false);
      onCreated(created.id, conversation.threadId);
    } catch (error) {
      setStartError(error);
    } finally {
      setIsStarting(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!isStarting) {
          mutation.reset();
          setStartError(null);
          onOpenChange(next);
        }
      }}
    >
      <DialogContent>
        <form onSubmit={(event) => void submit(event)}>
          <DialogHeader>
            <DialogTitle>{copy.createMatterTitle}</DialogTitle>
            <DialogDescription>
              {copy.createMatterDescription}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-5">
            <div className="grid gap-2">
              <label className="text-sm font-medium">{copy.workKind}</label>
              <Select
                value={kind}
                onValueChange={(value) => {
                  const nextKind = value as MatterKind;
                  setKind(nextKind);
                  if (nextKind === "case") setStage("intake");
                  else if (
                    nextKind === "contract_review" ||
                    nextKind === "document_drafting"
                  )
                    setStage("drafting");
                  else setStage("analysis");
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(copy.workKinds).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              {kind === "case" && (
                <div className="grid gap-2">
                  <label
                    className="text-sm font-medium"
                    htmlFor="law-case-number"
                  >
                    {copy.caseNumber}
                  </label>
                  <Input
                    id="law-case-number"
                    required
                    maxLength={120}
                    value={caseNumber}
                    onChange={(event) => setCaseNumber(event.target.value)}
                  />
                </div>
              )}
              <div className="grid gap-2">
                <label
                  className="text-sm font-medium"
                  htmlFor="law-matter-title"
                >
                  {copy.matterTitle}
                </label>
                <Input
                  id="law-matter-title"
                  required
                  maxLength={240}
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                />
              </div>
            </div>
            <div className="grid gap-2">
              <label className="text-sm font-medium" htmlFor="law-matter-cause">
                {copy.cause}
              </label>
              <Textarea
                id="law-matter-cause"
                maxLength={240}
                value={cause}
                onChange={(event) => setCause(event.target.value)}
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <label className="text-sm font-medium">{copy.stage}</label>
                <Select
                  value={stage}
                  onValueChange={(value) => setStage(value as MatterStage)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(copy.stages).map(([value, label]) => (
                      <SelectItem key={value} value={value}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <label className="text-sm font-medium">
                  {copy.classification}
                </label>
                <Select
                  value={classification}
                  onValueChange={(value) =>
                    setClassification(value as MatterClassification)
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(copy.classifications).map(
                      ([value, label]) => (
                        <SelectItem key={value} value={value}>
                          {label}
                        </SelectItem>
                      ),
                    )}
                  </SelectContent>
                </Select>
              </div>
            </div>
            {(mutation.isError || Boolean(startError)) && (
              <p role="alert" className="text-destructive text-sm">
                {errorMessage(startError ?? mutation.error, copy.requestFailed)}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isStarting}
            >
              {copy.cancel}
            </Button>
            <Button type="submit" disabled={isStarting || !tenantId}>
              {isStarting && <LoaderCircleIcon className="animate-spin" />}
              {isStarting ? copy.creating : copy.create}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function EmptyState({
  icon,
  title,
  description,
  action,
  onAction,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  action?: string;
  onAction?: () => void;
}) {
  return (
    <div className="flex min-h-72 flex-col items-center justify-center rounded-xl border border-dashed p-8 text-center">
      <div className="text-muted-foreground">{icon}</div>
      <h2 className="mt-4 text-lg font-semibold">{title}</h2>
      <p className="text-muted-foreground mt-2 max-w-md text-sm leading-6">
        {description}
      </p>
      {action && onAction && (
        <Button className="mt-5" onClick={onAction}>
          <PlusIcon />
          {action}
        </Button>
      )}
    </div>
  );
}

function ErrorState({
  message,
  retry,
  onRetry,
  compact = false,
}: {
  message: string;
  retry: string;
  onRetry: () => void;
  compact?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center rounded-lg border border-dashed text-center",
        compact ? "p-4" : "min-h-64 p-8",
      )}
    >
      <p role="alert" className="text-destructive text-sm">
        {message}
      </p>
      <Button variant="outline" size="sm" className="mt-4" onClick={onRetry}>
        <RefreshCwIcon />
        {retry}
      </Button>
    </div>
  );
}

function PageSkeleton() {
  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(16rem,0.8fr)_minmax(0,1.8fr)]">
      <Skeleton className="h-72 w-full" />
      <div className="space-y-5">
        <Skeleton className="h-44 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    </div>
  );
}
