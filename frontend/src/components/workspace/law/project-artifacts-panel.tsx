"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeftIcon,
  DownloadIcon,
  ExternalLinkIcon,
  FilePenLineIcon,
  RefreshCwIcon,
  XIcon,
  PlusIcon,
  Maximize2Icon,
  Minimize2Icon,
  FileTextIcon,
  FolderIcon,
  ChevronRightIcon,
  ScanTextIcon,
} from "lucide-react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { ArtifactFilePreview } from "@/components/workspace/artifacts/artifact-file-preview";
import { useArtifacts } from "@/components/workspace/artifacts/context";
import { importTextArtifactCopy } from "@/core/artifacts/api";
import { registerAuthSessionCleanup } from "@/core/auth/session-lifecycle";
import {
  fetchEvidenceContent,
  fetchProjectArtifactContent,
  fetchProjectArtifactExport,
  getMatterContextByThread,
  listProjectArtifacts,
  listProjectArtifactReviews,
  getMatter,
  listEvidence,
  listProjectArtifactVersions,
  useLawProjectArtifactSources,
  reviewProjectArtifactVersion,
  useLawThreadContext,
  type ProjectArtifact,
  type ProjectArtifactReviewDecision,
  type ProjectArtifactExportFormat,
  type ProjectArtifactVersion,
  type EvidenceItem,
} from "@/core/law";
import { isLegalAuthoritiesFile } from "@/core/law/legal-authorities";
import { isLegalGraphFile } from "@/core/law/legal-graph";
import type { WorkspaceAttachment } from "@/core/law/workspace-attachments";
import { cn } from "@/lib/utils";

import { EvidenceWorkbench, EvidenceUploadButton } from "./evidence-workbench";
import { LegalAuthoritiesImportHandoff } from "./legal-authorities-import-handoff";
import { LegalAuthoritiesPreview } from "./legal-authorities-preview";
import { LegalGraphImportHandoff } from "./legal-graph-import-handoff";
import { LegalGraphPreview } from "./legal-graph-preview";
import { LegalGraphStarter } from "./legal-graph-starter";
import { LegalTemplatePicker } from "./legal-template-picker";
import { MatterAuthoritiesPanel } from "./matter-authorities-panel";
import { MatterDeadlinePanel } from "./matter-deadline-panel";
import { MatterMemoryPanel } from "./matter-memory-panel";
import { MatterSpeechPanel } from "./matter-speech-panel";

const WorkspaceFileDetail = dynamic(() =>
  import("../artifacts/artifact-file-detail").then(
    (module) => module.ArtifactFileDetail,
  ),
);
type WorkTab =
  | { id: string; title: string; kind: "file"; path: string }
  | { id: string; title: string; kind: "evidence"; item: EvidenceItem }
  | { id: string; title: string; kind: "saved"; item: ProjectArtifact };

type SpeechCitationSource = Record<string, unknown> & {
  citation_id: string;
  evidence_item_id: string;
  evidence_version_id: string;
  audio_locator: { kind: "audio_time"; start_ms: number; end_ms: number };
};

function isSpeechCitationSource(
  citation: Record<string, unknown>,
): citation is SpeechCitationSource {
  const locator = citation.audio_locator;
  return (
    (citation.kind === "speech_transcript" ||
      citation.source_kind === "speech_transcript") &&
    typeof citation.citation_id === "string" &&
    typeof citation.evidence_item_id === "string" &&
    typeof citation.evidence_version_id === "string" &&
    typeof locator === "object" &&
    locator !== null &&
    (locator as Record<string, unknown>).kind === "audio_time" &&
    Number.isSafeInteger((locator as Record<string, unknown>).start_ms) &&
    Number.isSafeInteger((locator as Record<string, unknown>).end_ms) &&
    Number((locator as Record<string, unknown>).start_ms) >= 0 &&
    Number((locator as Record<string, unknown>).end_ms) >
      Number((locator as Record<string, unknown>).start_ms)
  );
}

function SpeechCitationSources({
  tenantId,
  matterId,
  citations,
}: {
  tenantId: string;
  matterId: string;
  citations: SpeechCitationSource[];
}) {
  const [activeCitation, setActiveCitation] =
    useState<SpeechCitationSource | null>(null);
  const [mediaUrl, setMediaUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const mediaRef = useRef<HTMLAudioElement | null>(null);
  const requestRef = useRef<AbortController | null>(null);
  const objectUrlRef = useRef<string | null>(null);
  const activeSourceKeyRef = useRef<string | null>(null);

  const clearSensitiveMedia = useCallback(() => {
    requestRef.current?.abort();
    requestRef.current = null;
    mediaRef.current?.pause();
    mediaRef.current?.removeAttribute("src");
    mediaRef.current?.load();
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    objectUrlRef.current = null;
    activeSourceKeyRef.current = null;
    setMediaUrl(null);
    setActiveCitation(null);
    setLoading(false);
    setError("");
  }, []);

  useEffect(() => {
    const unregister = registerAuthSessionCleanup(clearSensitiveMedia);
    return () => {
      unregister();
      clearSensitiveMedia();
    };
  }, [clearSensitiveMedia]);

  const seekToCitation = useCallback((citation: SpeechCitationSource) => {
    const audio = mediaRef.current;
    if (!audio || audio.readyState < 1) return;
    audio.currentTime = citation.audio_locator.start_ms / 1000;
  }, []);

  const loadOrLocate = useCallback(
    async (citation: SpeechCitationSource) => {
      const sourceKey = `${citation.evidence_item_id}:${citation.evidence_version_id}`;
      setActiveCitation(citation);
      setError("");
      if (activeSourceKeyRef.current === sourceKey && mediaRef.current) {
        seekToCitation(citation);
        mediaRef.current.focus();
        return;
      }

      requestRef.current?.abort();
      const controller = new AbortController();
      requestRef.current = controller;
      setLoading(true);
      setMediaUrl(null);
      activeSourceKeyRef.current = null;
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = null;
      }
      try {
        const blob = await fetchEvidenceContent(
          tenantId,
          matterId,
          citation.evidence_item_id,
          citation.evidence_version_id,
          controller.signal,
        );
        if (controller.signal.aborted) return;
        const url = URL.createObjectURL(blob);
        objectUrlRef.current = url;
        activeSourceKeyRef.current = sourceKey;
        setMediaUrl(url);
      } catch (loadError) {
        if (!controller.signal.aborted)
          setError(
            loadError instanceof Error
              ? loadError.message
              : "无法读取受保护的录音来源。",
          );
      } finally {
        if (requestRef.current === controller) {
          requestRef.current = null;
          setLoading(false);
        }
      }
    },
    [matterId, seekToCitation, tenantId],
  );

  const formatSeconds = (milliseconds: number) =>
    `${(milliseconds / 1000).toFixed(1)} 秒`;

  return (
    <div className="space-y-2" aria-label="语音来源与音频定位">
      {citations.map((citation) => (
        <div
          key={citation.citation_id}
          className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-2"
        >
          <p className="break-all">
            录音来源 ·{" "}
            {typeof citation.recording_name === "string"
              ? citation.recording_name
              : "案件录音"}{" "}·{" "}
            {formatSeconds(citation.audio_locator.start_ms)}–
            {formatSeconds(citation.audio_locator.end_ms)} · 转写引用 {citation.citation_id}
            {typeof citation.transcript_version_id === "string" && (
              <> · 固定转写版本 {citation.transcript_version_id}</>
            )}
          </p>
          <Button
            type="button"
            size="sm"
            variant="outline"
            aria-label={`定位录音 ${formatSeconds(citation.audio_locator.start_ms)} 至 ${formatSeconds(citation.audio_locator.end_ms)}`}
            onClick={() => void loadOrLocate(citation)}
            disabled={loading}
          >
            {activeCitation?.citation_id === citation.citation_id && mediaUrl
              ? "定位到录音时间"
              : "加载录音并定位"}
          </Button>
        </div>
      ))}
      {loading && (
        <p role="status" className="text-muted-foreground">
          正在读取受保护的录音来源…
        </p>
      )}
      {error && (
        <p role="alert" className="text-destructive">
          录音来源当前不可读取：{error}
        </p>
      )}
      {activeCitation && mediaUrl && (
        <audio
          ref={mediaRef}
          aria-label="固定版本录音来源播放器"
          controls
          preload="metadata"
          src={mediaUrl}
          onLoadedMetadata={() => seekToCitation(activeCitation)}
          className="w-full"
        />
      )}
    </div>
  );
}

export function ProjectArtifactsPanel({
  threadId,
  expanded = false,
  onExpandedChange,
  attachments = [],
}: {
  threadId: string;
  children?: ReactNode;
  expanded?: boolean;
  onExpandedChange?: (value: boolean) => void;
  attachments?: WorkspaceAttachment[];
}) {
  const context = useLawThreadContext(threadId);
  if (context.isPending)
    return (
      <p role="status" className="p-4 text-sm">
        正在加载工作区…
      </p>
    );
  if (context.isError || !context.data)
    return (
      <div className="space-y-3 p-4">
        <p role="alert">无法访问工作区，请检查权限或稍后重试。</p>
        <Button variant="outline" onClick={() => void context.refetch()}>
          重试
        </Button>
      </div>
    );
  const scope = context.data;
  return (
    <LegalDocumentWorkspace
      key={`${threadId}:${scope.user_id}:${scope.tenant_id}:${scope.matter_id}:${scope.membership_id}:${scope.mapping_id}:${scope.context_version}:${scope.policy_version}`}
      threadId={threadId}
      scope={scope}
      expanded={expanded}
      onExpandedChange={onExpandedChange}
      attachments={attachments}
    />
  );
}

function LegalDocumentWorkspace({
  threadId,
  scope,
  expanded,
  onExpandedChange,
  attachments,
}: {
  threadId: string;
  scope: NonNullable<ReturnType<typeof useLawThreadContext>["data"]>;
  expanded: boolean;
  onExpandedChange?: (value: boolean) => void;
  attachments: WorkspaceAttachment[];
}) {
  const {
    artifacts,
    selectedArtifact,
    selectionVersion,
    select,
    setOpen,
    drafts,
  } = useArtifacts();
  const [active, setActive] = useState("overview");
  const [tabs, setTabs] = useState<WorkTab[]>([]);
  const [closeTarget, setCloseTarget] = useState<string | null>(null);
  const matter = useQuery({
    queryKey: ["law", "matter", scope.tenant_id, scope.matter_id],
    queryFn: ({ signal }) =>
      getMatter(scope.tenant_id, scope.matter_id, signal),
    retry: false,
  });
  const evidence = useQuery({
    queryKey: ["law", "evidence", scope.tenant_id, scope.matter_id],
    queryFn: ({ signal }) =>
      listEvidence(scope.tenant_id, scope.matter_id, signal),
    retry: false,
  });
  const openTab = (tab: WorkTab) => {
    setTabs((current) =>
      current.some((row) => row.id === tab.id) ? current : [...current, tab],
    );
    setActive(tab.id);
  };
  const openFile = (path: string) => {
    openTab({
      id: `file:${path}`,
      kind: "file",
      path,
      title: path.split("/").at(-1) ?? "文件",
    });
    select(path);
  };
  useEffect(() => {
    if (!selectedArtifact) return;
    const path = selectedArtifact;
    setTabs((current) =>
      current.some((row) => row.id === `file:${path}`)
        ? current
        : [
            ...current,
            {
              id: `file:${path}`,
              kind: "file",
              path,
              title: path.split("/").at(-1) ?? "文件",
            },
          ],
    );
    setActive(`file:${path}`);
  }, [selectedArtifact, selectionVersion]);
  const overviewTitle = scope.work_kind === "case" ? "案件概览" : "项目概览";
  const openEvidence = (item: EvidenceItem) =>
    openTab({
      id: `evidence:${item.id}`,
      kind: "evidence",
      title: item.title,
      item,
    });
  const removeTab = (id: string) => {
    setTabs((current) => current.filter((row) => row.id !== id));
    if (active === id) setActive("overview");
    setCloseTarget(null);
  };
  const closeTab = (tab: WorkTab) => {
    const draft = tab.kind === "file" ? drafts[tab.path] : undefined;
    if (
      tab.kind === "evidence" ||
      (draft && draft.draftContent !== draft.baselineContent)
    ) {
      setCloseTarget(tab.id);
      return;
    }
    removeTab(tab.id);
  };
  return (
    <section
      className="flex size-full min-h-0 min-w-0 flex-col"
      aria-label="法律文档工作区"
    >
      <div className="flex shrink-0 items-center border-b">
        <div
          role="tablist"
          aria-label="工作区文件"
          className="flex min-w-0 flex-1 items-center overflow-x-auto"
        >
          {[{ id: "overview", title: overviewTitle }, ...tabs].map((tab) => (
            <div
              key={tab.id}
              className={cn(
                "flex shrink-0 items-center border-r",
                active === tab.id && "bg-muted",
              )}
            >
              <button
                role="tab"
                id={`work-tab-${tab.id}`}
                aria-selected={active === tab.id}
                aria-controls={`work-panel-${tab.id}`}
                tabIndex={active === tab.id ? 0 : -1}
                className="focus-visible:ring-ring flex max-w-48 items-center gap-2 px-3 py-3 text-sm outline-none focus-visible:ring-2"
                onClick={() => setActive(tab.id)}
                onKeyDown={(event) => {
                  const ids = ["overview", ...tabs.map((row) => row.id)];
                  const index = ids.indexOf(tab.id);
                  if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
                    event.preventDefault();
                    const next =
                      ids[
                        (index +
                          (event.key === "ArrowRight" ? 1 : ids.length - 1)) %
                          ids.length
                      ]!;
                    setActive(next);
                    document.getElementById(`work-tab-${next}`)?.focus();
                  }
                }}
              >
                {tab.id === "overview" ? (
                  <FolderIcon className="size-4 shrink-0" />
                ) : (
                  <FileTextIcon className="size-4 shrink-0" />
                )}
                <span className="truncate">{tab.title}</span>
              </button>
              {tab.id !== "overview" && (
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label={`关闭 ${tab.title}`}
                  onClick={() => closeTab(tab as WorkTab)}
                >
                  <XIcon />
                </Button>
              )}
            </div>
          ))}
        </div>
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label="工作入口"
          onClick={() => setActive("overview")}
        >
          <PlusIcon />
        </Button>
        {onExpandedChange && (
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label={expanded ? "退出展开工作区" : "展开工作区"}
            onClick={() => onExpandedChange(!expanded)}
          >
            {expanded ? <Minimize2Icon /> : <Maximize2Icon />}
          </Button>
        )}
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label="关闭工作区"
          onClick={() => {
            onExpandedChange?.(false);
            setOpen(false);
          }}
        >
          <XIcon />
        </Button>
      </div>
      <div
        id="work-panel-overview"
        role="tabpanel"
        aria-labelledby="work-tab-overview"
        hidden={active !== "overview"}
        className="min-h-0 flex-1 overflow-y-auto p-5"
      >
        <div className="mb-7 flex items-start gap-3">
          <FolderIcon className="mt-1 size-7 shrink-0" />
          <div className="min-w-0">
            <h2 className="text-xl font-semibold break-words">
              {matter.data?.title ??
                (matter.isError ? "项目资料暂不可用" : "正在加载项目…")}
            </h2>
            <p className="text-muted-foreground mt-1 text-sm">
              当前对话的材料与成果
            </p>
          </div>
        </div>
        <section className="mb-7">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold">办案成果</h3>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setActive("saved")}
            >
              查看全部成果
            </Button>
          </div>
          <div className="divide-y rounded-lg border">
            {artifacts.length ? (
              artifacts.map((path) => (
                <WorkspaceRow
                  key={path}
                  title={path.split("/").at(-1) ?? path}
                  description="本会话文件"
                  onClick={() => openFile(path)}
                />
              ))
            ) : (
              <p className="text-muted-foreground p-4 text-sm">
                本次对话尚未生成成果。
              </p>
            )}
          </div>
        </section>
        <section className="mb-7">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold">材料来源</h3>
            <EvidenceUploadButton
              tenantId={scope.tenant_id}
              matterId={scope.matter_id}
              locale="zh-CN"
              onUploaded={openEvidence}
            />
          </div>
          <div className="divide-y rounded-lg border">
            {attachments.length ? (
              attachments.map((file) => (
                <WorkspaceRow
                  key={file.path}
                  title={file.filename}
                  description="本会话上传附件 · 是否用于分析以对话为准"
                  onClick={() => openFile(file.path)}
                />
              ))
            ) : (
              <p className="text-muted-foreground p-4 text-sm">
                本次对话尚无可核实的附件记录。
              </p>
            )}
          </div>
          {tabs.some((tab) => tab.kind === "evidence") && (
            <div className="mt-3">
              <p className="text-muted-foreground mb-2 text-xs">
                本次打开的案件材料
              </p>
              <div className="divide-y rounded-lg border">
                {tabs
                  .filter(
                    (tab): tab is Extract<WorkTab, { kind: "evidence" }> =>
                      tab.kind === "evidence",
                  )
                  .map((tab) => (
                    <WorkspaceRow
                      key={tab.id}
                      title={tab.title}
                      description="本次打开"
                      onClick={() => setActive(tab.id)}
                    />
                  ))}
              </div>
            </div>
          )}
          <Button
            variant="link"
            className="mt-2 px-0"
            onClick={() => setActive("materials")}
          >
            查看案件全部材料
            <ChevronRightIcon />
          </Button>
        </section>
        <MatterMemoryPanel
          tenantId={scope.tenant_id}
          matterId={scope.matter_id}
        />
        <MatterDeadlinePanel
          tenantId={scope.tenant_id}
          matterId={scope.matter_id}
          matterRole={scope.matter_role}
          currentMembershipId={scope.membership_id}
        />
        <MatterSpeechPanel
          tenantId={scope.tenant_id}
          matterId={scope.matter_id}
          matterRole={scope.matter_role}
          userId={scope.user_id}
          membershipId={scope.membership_id}
        />
        <MatterAuthoritiesPanel
          tenantId={scope.tenant_id}
          matterId={scope.matter_id}
        />
        <section>
          <h3 className="mb-3 text-sm font-semibold">工作入口</h3>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 @[420px]:grid-cols-2">
            <Button
              variant="outline"
              className="h-14 justify-start"
              onClick={() => setActive("materials")}
            >
              <FileTextIcon />
              查看原件
            </Button>
            <Button
              variant="outline"
              className="h-14 justify-start"
              onClick={() => setActive("materials")}
            >
              <ScanTextIcon />
              文档校对
            </Button>
            <div className="rounded-md border p-2">
              <LegalTemplatePicker threadId={threadId} />
            </div>
            <div className="rounded-md border p-2">
              <LegalGraphStarter threadId={threadId} />
            </div>
          </div>
        </section>
        <p className="text-muted-foreground mt-7 border-t pt-4 text-center text-xs">
          选择文件，在这里查看或编辑
        </p>
      </div>
      <div
        hidden={active !== "materials"}
        className="min-h-0 flex-1 overflow-y-auto p-4"
      >
        <div className="mb-3 flex items-center justify-between">
          <Button variant="ghost" onClick={() => setActive("overview")}>
            <ArrowLeftIcon />
            返回概览
          </Button>
          <h2 className="text-sm font-semibold">案件全部材料</h2>
          <EvidenceUploadButton
            tenantId={scope.tenant_id}
            matterId={scope.matter_id}
            locale="zh-CN"
            onUploaded={openEvidence}
          />
        </div>
        {evidence.isPending ? (
          <p role="status">正在加载材料…</p>
        ) : evidence.isError ? (
          <div>
            <p role="alert">无法读取案件材料。</p>
            <Button onClick={() => void evidence.refetch()}>重试</Button>
          </div>
        ) : !evidence.data?.length ? (
          <p className="text-muted-foreground text-sm">还没有项目材料。</p>
        ) : (
          <div className="divide-y rounded-lg border">
            {evidence.data.map((item) => (
              <WorkspaceRow
                key={item.id}
                title={item.title}
                description={item.status === "archived" ? "已归档" : "案件材料"}
                onClick={() => openEvidence(item)}
              />
            ))}
          </div>
        )}
      </div>
      {active === "saved" && (
        <div className="min-h-0 flex-1">
          <Button
            variant="ghost"
            className="m-2"
            onClick={() => setActive("overview")}
          >
            <ArrowLeftIcon />
            返回概览
          </Button>
          <ProjectArtifactBrowser
            threadId={threadId}
            onOpenProjectArtifact={(item) =>
              openTab({
                id: `saved:${item.id}`,
                kind: "saved",
                title: item.title,
                item,
              })
            }
            onOpenThreadArtifact={openFile}
          />
        </div>
      )}
      {tabs.map((tab) => (
        <div
          key={tab.id}
          id={`work-panel-${tab.id}`}
          role="tabpanel"
          aria-labelledby={`work-tab-${tab.id}`}
          hidden={active !== tab.id}
          className="min-h-0 flex-1 overflow-hidden"
        >
          {tab.kind === "file" ? (
            <WorkspaceFileDetail
              className="size-full"
              filepath={tab.path}
              threadId={threadId}
            />
          ) : tab.kind === "evidence" ? (
            <EvidenceWorkbench
              tenantId={scope.tenant_id}
              matterId={scope.matter_id}
              locale="zh-CN"
              mode="document"
              initialEvidenceId={tab.item.id}
            />
          ) : (
            <ProjectArtifactDetail
              artifact={tab.item}
              threadId={threadId}
              canReview={["owner", "lead", "lawyer"].includes(
                scope.matter_role,
              )}
              onBack={() => setActive("saved")}
              onOpenThreadArtifact={openFile}
            />
          )}
        </div>
      ))}
      <Dialog
        open={Boolean(closeTarget)}
        onOpenChange={(open) => {
          if (!open) setCloseTarget(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>关闭文件</DialogTitle>
            <DialogDescription>
              请先确认修改已保存。关闭材料会结束校对视图；保存失败的修改请先保留。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                if (closeTarget) setActive(closeTarget);
                setCloseTarget(null);
              }}
            >
              返回文件
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (closeTarget) removeTab(closeTarget);
              }}
            >
              确认关闭
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

function WorkspaceRow({
  title,
  description,
  onClick,
}: {
  title: string;
  description: string;
  onClick: () => void;
}) {
  return (
    <button
      className="hover:bg-muted focus-visible:ring-ring flex w-full items-center gap-3 p-4 text-left outline-none focus-visible:ring-2"
      onClick={onClick}
    >
      <FileTextIcon className="text-muted-foreground size-5 shrink-0" />
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium break-words">{title}</span>
        <span className="text-muted-foreground mt-1 block text-xs">
          {description}
        </span>
      </span>
      <ChevronRightIcon className="text-muted-foreground size-4 shrink-0" />
    </button>
  );
}

function ProjectArtifactBrowser({
  threadId,
  onOpenThreadArtifact,
  onOpenProjectArtifact,
}: {
  threadId: string;
  onOpenProjectArtifact?: (artifact: ProjectArtifact) => void;
  onOpenThreadArtifact: (path: string) => void;
}) {
  const context = useLawThreadContext(threadId);
  const scope = context.data;
  const { setOpen } = useArtifacts();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const items = useQuery({
    queryKey: ["law", "project-artifacts", scope?.tenant_id, scope?.matter_id],
    queryFn: ({ signal }) =>
      listProjectArtifacts(scope!.tenant_id, scope!.matter_id, signal),
    enabled: Boolean(scope) && !context.isError,
    retry: false,
  });
  if (context.isError || items.isError)
    return (
      <div className="space-y-3 p-4">
        <p role="alert">无法访问项目成果，请检查权限或稍后重试。</p>
        <Button
          variant="outline"
          onClick={() => {
            void context.refetch();
            if (scope) void items.refetch();
          }}
        >
          重试
        </Button>
        <Button variant="ghost" onClick={() => setOpen(false)}>
          关闭
        </Button>
      </div>
    );
  const selected = items.data?.find((item) => item.id === selectedId);
  if (selected)
    return (
      <ProjectArtifactDetail
        key={`${selected.tenant_id}:${selected.matter_id}:${selected.id}`}
        artifact={selected}
        threadId={threadId}
        canReview={Boolean(
          scope && ["owner", "lead", "lawyer"].includes(scope.matter_role),
        )}
        onBack={() => setSelectedId(null)}
        onOpenThreadArtifact={onOpenThreadArtifact}
      />
    );
  return (
    <section className="flex size-full flex-col">
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b p-3">
        <h2 className="font-medium">项目成果</h2>
        <div className="flex flex-wrap gap-1">
          {scope && (
            <LegalAuthoritiesImportHandoff
              key={`authorities:${threadId}`}
              threadId={threadId}
            />
          )}
          {scope && (
            <LegalGraphImportHandoff key={threadId} threadId={threadId} />
          )}
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="刷新项目成果"
            disabled={!scope || items.isFetching}
            onClick={() => void items.refetch()}
          >
            <RefreshCwIcon />
          </Button>
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="关闭项目成果"
            onClick={() => setOpen(false)}
          >
            <XIcon />
          </Button>
        </div>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {items.isPending ? (
          <p role="status">正在加载项目成果…</p>
        ) : !items.data?.length ? (
          <p className="text-muted-foreground text-sm">
            还没有已保存成果。在本会话文件中打开文书或笔记，点击“保存到项目”。
          </p>
        ) : (
          <ul className="space-y-2">
            {items.data.map((item) => (
              <li key={item.id}>
                <button
                  className="hover:bg-muted focus-visible:ring-ring w-full cursor-pointer rounded-md border p-3 text-left focus-visible:ring-2"
                  onClick={() =>
                    onOpenProjectArtifact
                      ? onOpenProjectArtifact(item)
                      : setSelectedId(item.id)
                  }
                >
                  <span className="block font-medium break-words">
                    {item.title}
                  </span>
                  <span className="text-muted-foreground text-xs">
                    第 {item.current_version_number} 版 ·{" "}
                    {item.status === "archived" ? "已归档" : "已保存"}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function ProjectArtifactDetail({
  artifact,
  threadId,
  canReview,
  onBack,
  onOpenThreadArtifact,
}: {
  artifact: ProjectArtifact;
  threadId: string;
  canReview: boolean;
  onBack: () => void;
  onOpenThreadArtifact: (path: string) => void;
}) {
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(
    null,
  );
  const versions = useQuery({
    queryKey: [
      "law",
      "project-artifact-versions",
      artifact.tenant_id,
      artifact.matter_id,
      artifact.id,
    ],
    queryFn: ({ signal }) =>
      listProjectArtifactVersions(
        artifact.tenant_id,
        artifact.matter_id,
        artifact.id,
        signal,
      ),
    retry: false,
  });
  const version = selectedVersionId
    ? versions.data?.find((row) => row.id === selectedVersionId)
    : versions.data?.find(
        (row) => row.version_number === artifact.current_version_number,
      );
  return (
    <section className="flex size-full min-h-0 flex-col">
      <header className="space-y-2 border-b p-3">
        <div className="flex items-center gap-2">
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="返回项目成果"
            onClick={onBack}
          >
            <ArrowLeftIcon />
          </Button>
          <h2 className="min-w-0 font-medium break-words">{artifact.title}</h2>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <span className="shrink-0">历史版本</span>
          <select
            className="bg-background min-w-0 flex-1 rounded-md border p-2"
            value={version?.id ?? ""}
            onChange={(event) => setSelectedVersionId(event.target.value)}
            disabled={versions.isPending || versions.isError}
          >
            {!version && <option value="">请选择版本</option>}
            {versions.data?.map((row) => (
              <option key={row.id} value={row.id}>
                第 {row.version_number} 版 ·{" "}
                {new Date(row.created_at).toLocaleString()}
              </option>
            ))}
          </select>
        </label>
      </header>
      {versions.isError ? (
        <p role="alert" className="p-4">
          无法加载版本，请返回列表刷新权限。
        </p>
      ) : !version ? (
        <p role="status" className="p-4">
          {versions.isPending
            ? "正在加载版本…"
            : "未找到所选版本，请返回刷新。"}
        </p>
      ) : (
        <ProjectArtifactContent
          key={version.id}
          version={version}
          threadId={threadId}
          canReview={canReview}
          canExport={
            artifact.status === "active" &&
            [
              "document",
              "note",
              "contract_review",
              "timeline",
              "transcript",
              "legal_research",
              "knowledge_graph",
            ].includes(artifact.kind)
          }
          artifactKind={artifact.kind}
          isGraph={artifact.kind === "knowledge_graph"}
          onOpenThreadArtifact={onOpenThreadArtifact}
        />
      )}
    </section>
  );
}

function ProjectArtifactContent({
  version,
  threadId,
  canReview,
  canExport,
  artifactKind,
  isGraph,
  onOpenThreadArtifact,
}: {
  version: ProjectArtifactVersion;
  threadId: string;
  canReview: boolean;
  canExport: boolean;
  artifactKind: ProjectArtifact["kind"];
  isGraph: boolean;
  onOpenThreadArtifact: (path: string) => void;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [content, setContent] = useState<{ text?: string; url: string } | null>(
    null,
  );
  const [error, setError] = useState("");
  const [navigationError, setNavigationError] = useState("");
  const [downloading, setDownloading] = useState(false);
  const [exporting, setExporting] =
    useState<ProjectArtifactExportFormat | null>(null);
  const [copying, setCopying] = useState(false);
  const [reviewDialogOpen, setReviewDialogOpen] = useState(false);
  const [reviewNote, setReviewNote] = useState("");
  const [reviewError, setReviewError] = useState("");
  const reviewIdempotency = useRef<{ fingerprint: string; key: string } | null>(
    null,
  );
  const reviews = useQuery({
    queryKey: [
      "law",
      "project-artifact-reviews",
      version.tenant_id,
      version.matter_id,
      version.project_artifact_id,
      version.id,
    ],
    queryFn: ({ signal }) =>
      listProjectArtifactReviews(
        version.tenant_id,
        version.matter_id,
        version.project_artifact_id,
        version.id,
        signal,
      ),
    enabled: canReview,
    retry: false,
  });
  const sourcesQuery = useLawProjectArtifactSources(
    version.tenant_id,
    version.matter_id,
    version.project_artifact_id,
    version.id,
  );
  const sourceManifest = sourcesQuery.data?.source_manifest;
  const sourceCitations = Array.isArray(sourceManifest?.citations)
    ? (sourceManifest.citations as Array<Record<string, unknown>>)
    : [];
  const speechSourceCitations = sourceCitations.filter(isSpeechCitationSource);
  const otherSourceCitations = sourceCitations.filter(
    (citation) => !isSpeechCitationSource(citation),
  );
  const sourceAuthorities = Array.isArray(sourceManifest?.authorities)
    ? (sourceManifest.authorities as Array<Record<string, unknown>>)
    : [];
  const strategyLineage =
    sourceManifest?.derived_from &&
    typeof sourceManifest.derived_from === "object"
      ? (sourceManifest.derived_from as Record<string, unknown>)
      : null;
  const templateLineage =
    sourceManifest?.template && typeof sourceManifest.template === "object"
      ? (sourceManifest.template as Record<string, unknown>)
      : null;
  const reviewMutation = useMutation({
    mutationFn: (input: {
      decision: ProjectArtifactReviewDecision;
      reviewNote: string;
      idempotencyKey: string;
    }) =>
      reviewProjectArtifactVersion({
        tenantId: version.tenant_id,
        matterId: version.matter_id,
        artifactId: version.project_artifact_id,
        versionId: version.id,
        ...input,
      }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: [
            "law",
            "project-artifact-versions",
            version.tenant_id,
            version.matter_id,
            version.project_artifact_id,
          ],
        }),
        queryClient.invalidateQueries({
          queryKey: [
            "law",
            "project-artifact-reviews",
            version.tenant_id,
            version.matter_id,
            version.project_artifact_id,
            version.id,
          ],
        }),
      ]);
    },
  });
  const alive = useRef(true);
  const downloadRequest = useRef<AbortController | null>(null);
  const downloadUrls = useRef(new Set<string>());
  useEffect(() => {
    alive.current = true;
    const urls = downloadUrls.current;
    return () => {
      alive.current = false;
      downloadRequest.current?.abort();
      urls.forEach((url) => URL.revokeObjectURL(url));
      urls.clear();
    };
  }, []);
  const isText = ["text/markdown", "text/plain", "application/json"].includes(
    version.media_type,
  );
  useEffect(() => {
    const active = new AbortController();
    let objectUrl: string | undefined;
    void (async () => {
      try {
        const blob = await fetchProjectArtifactContent(version, active.signal);
        const text = isText
          ? new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
              await blob.arrayBuffer(),
            )
          : undefined;
        active.signal.throwIfAborted();
        objectUrl = URL.createObjectURL(blob);
        setContent({ text, url: objectUrl });
      } catch (cause) {
        if (!active.signal.aborted)
          setError(
            cause instanceof Error ? cause.message : "无法读取成果内容。",
          );
      }
    })();
    return () => {
      active.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [version, isText]);

  async function openSource() {
    setNavigationError("");
    if (!version.source_thread_id) {
      setNavigationError("该版本来自案件工作区编辑，没有来源会话。");
      return;
    }
    try {
      const context = await getMatterContextByThread(version.source_thread_id);
      if (!alive.current) return;
      if (
        context.tenant_id !== version.tenant_id ||
        context.matter_id !== version.matter_id
      )
        throw new Error("来源会话已不属于当前项目。");
      router.push(
        `/workspace/chats/${encodeURIComponent(version.source_thread_id)}`,
      );
    } catch {
      if (!alive.current) return;
      setNavigationError(
        "来源会话已不可用或当前用户无访问权限；已保存版本不受影响。",
      );
    }
  }

  async function download() {
    if (downloading) return;
    const active = new AbortController();
    downloadRequest.current = active;
    setDownloading(true);
    setNavigationError("");
    try {
      const blob = await fetchProjectArtifactContent(version, active.signal);
      if (!alive.current) return;
      const url = URL.createObjectURL(blob);
      downloadUrls.current.add(url);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = version.original_filename;
      anchor.click();
      setTimeout(() => {
        URL.revokeObjectURL(url);
        downloadUrls.current.delete(url);
      }, 1000);
    } catch (cause) {
      if (alive.current)
        setNavigationError(
          cause instanceof Error ? cause.message : "无法下载此版本。",
        );
    } finally {
      if (alive.current) setDownloading(false);
    }
  }

  async function exportApproved(format: ProjectArtifactExportFormat) {
    if (downloading || !canExport || version.review_status !== "approved")
      return;
    const active = new AbortController();
    downloadRequest.current = active;
    setDownloading(true);
    setExporting(format);
    setNavigationError("");
    try {
      const blob = await fetchProjectArtifactExport(
        version,
        format,
        active.signal,
      );
      if (!alive.current) return;
      const url = URL.createObjectURL(blob);
      downloadUrls.current.add(url);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `artifact-v${version.version_number}-${format}-export.zip`;
      anchor.click();
      setTimeout(() => {
        URL.revokeObjectURL(url);
        downloadUrls.current.delete(url);
      }, 1000);
    } catch (cause) {
      if (alive.current)
        setNavigationError(
          cause instanceof Error ? cause.message : "无法导出已审核成果。",
        );
    } finally {
      if (alive.current) {
        setDownloading(false);
        setExporting(null);
      }
    }
  }

  async function createEditableCopy() {
    if (!content?.text || copying) return;
    setCopying(true);
    setNavigationError("");
    try {
      const result = await importTextArtifactCopy({
        threadId,
        filename: version.original_filename,
        content: content.text,
        sourceSha256: version.sha256,
      });
      if (!alive.current) return;
      onOpenThreadArtifact(result.path);
    } catch (cause) {
      if (alive.current)
        setNavigationError(
          cause instanceof Error ? cause.message : "无法创建会话工作副本。",
        );
    } finally {
      if (alive.current) setCopying(false);
    }
  }

  async function submitReview(decision: ProjectArtifactReviewDecision) {
    const note = reviewNote.trim();
    if (!note) {
      setReviewError("请填写审核意见。");
      return;
    }
    const fingerprint = JSON.stringify({ decision, note });
    if (reviewIdempotency.current?.fingerprint !== fingerprint) {
      reviewIdempotency.current = {
        fingerprint,
        key: globalThis.crypto.randomUUID(),
      };
    }
    setReviewError("");
    try {
      await reviewMutation.mutateAsync({
        decision,
        reviewNote: note,
        idempotencyKey: reviewIdempotency.current.key,
      });
      reviewIdempotency.current = null;
      setReviewNote("");
      setReviewDialogOpen(false);
    } catch (cause) {
      setReviewError(
        cause instanceof Error ? cause.message : "无法保存版本审核记录。",
      );
    }
  }

  const reviewStatusLabel =
    version.latest_review?.decision === "approved"
      ? "律师已审核通过"
      : version.latest_review?.decision === "changes_requested"
        ? "律师已要求修改"
        : version.review_status === "unreviewed"
          ? "未审核"
          : "已记录审核状态";
  const exportFormats: ProjectArtifactExportFormat[] = (() => {
    if (!canExport) return [];
    if (version.media_type === "application/pdf") return ["pdf"];
    if (
      version.media_type ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    )
      return ["docx"];
    if (["text/markdown", "text/plain"].includes(version.media_type))
      return ["docx", "pdf"];
    if (
      version.media_type === "application/json" &&
      ["legal_research", "knowledge_graph"].includes(artifactKind)
    )
      return ["docx", "pdf"];
    return [];
  })();

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="space-y-2 border-b p-3">
        <p className="text-muted-foreground text-xs">
          只读快照 · {reviewStatusLabel} · 来源回执应在审核前核对
        </p>
        {version.media_type === "text/markdown" && (
          <div className="space-y-2">
            {sourcesQuery.isError ? (
              <p role="alert" className="text-destructive text-xs">
                来源回执读取失败；重新读取成功前不能审核此版本。
              </p>
            ) : sourcesQuery.isPending ? (
              <p role="status" className="text-muted-foreground text-xs">
                正在核验此版本的来源回执…
              </p>
            ) : (
              <details className="rounded-md border p-2 text-xs">
                <summary className="cursor-pointer font-medium">
                  来源回执 · 材料 {sourceCitations.length} · 法源{" "}
                  {sourceAuthorities.length}
                </summary>
                <div className="mt-2 space-y-2">
                  {otherSourceCitations.map((citation) => (
                    <p key={String(citation.citation_id)} className="break-all">
                      材料版本 {String(citation.evidence_version_id)} · 第{" "}
                      {String(citation.physical_page_number)} 页 · 引用{" "}
                      {String(citation.citation_id)}
                    </p>
                  ))}
                  {speechSourceCitations.length > 0 && (
                    <SpeechCitationSources
                      tenantId={version.tenant_id}
                      matterId={version.matter_id}
                      citations={speechSourceCitations}
                    />
                  )}
                  {sourceAuthorities.map((authority) => (
                    <p key={String(authority.version_id)} className="break-all">
                      法源版本 {String(authority.version_id)} · 审核{" "}
                      {typeof authority.review_id === "string"
                        ? authority.review_id
                        : "未提供，未核验"}
                    </p>
                  ))}
                  {strategyLineage && (
                    <p className="break-all">
                      诉讼策略版本 {String(strategyLineage.version_id)} ·
                      SHA-256 {String(strategyLineage.sha256)}
                    </p>
                  )}
                  {templateLineage && (
                    <p className="break-all">
                      模板 {String(templateLineage.template_id)} · SHA-256{" "}
                      {String(templateLineage.template_sha256)}
                    </p>
                  )}
                  {sourceCitations.length === 0 &&
                    sourceAuthorities.length === 0 &&
                    !strategyLineage &&
                    !templateLineage && (
                      <p className="text-muted-foreground">
                        该版本没有显式材料或法源引用；正文 SHA-256 已绑定。
                      </p>
                    )}
                </div>
              </details>
            )}
          </div>
        )}
        {canReview && canExport && (
          <p className="text-muted-foreground text-xs">
            审核通过后可导出 DOCX 或 PDF 包，附带来源清单、成果摘要和审核回执。
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={!version.source_thread_id}
            onClick={() => void openSource()}
          >
            <ExternalLinkIcon />
            来源会话
          </Button>
          {content && (
            <Button
              size="sm"
              variant="outline"
              disabled={downloading}
              onClick={() => void download()}
            >
              <DownloadIcon />
              {downloading ? "正在核验下载…" : "下载此版本"}
            </Button>
          )}
          {canReview && (
            <Button
              size="sm"
              variant="outline"
              disabled={
                !content ||
                reviewMutation.isPending ||
                (version.media_type === "text/markdown" &&
                  (sourcesQuery.isPending || sourcesQuery.isError))
              }
              onClick={() => {
                setReviewError("");
                setReviewDialogOpen(true);
              }}
            >
              审核此版本
            </Button>
          )}
          {canReview &&
            version.review_status === "approved" &&
            exportFormats.map((format) => (
              <Button
                key={format}
                size="sm"
                variant="outline"
                disabled={downloading || !content}
                onClick={() => void exportApproved(format)}
              >
                <DownloadIcon />
                {exporting === format
                  ? `正在生成 ${format.toUpperCase()} 包…`
                  : `导出 ${format.toUpperCase()} + 来源回执`}
              </Button>
            ))}
          {content?.text !== undefined &&
            ["text/markdown", "text/plain", "application/json"].includes(
              version.media_type,
            ) && (
              <Button
                size="sm"
                variant="default"
                disabled={copying}
                onClick={() => void createEditableCopy()}
              >
                <FilePenLineIcon />
                {copying ? "正在创建副本…" : "创建会话工作副本"}
              </Button>
            )}
        </div>
        {navigationError && (
          <p role="alert" className="text-destructive text-sm">
            {navigationError}
          </p>
        )}
        {canReview && reviews.data && reviews.data.length > 0 && (
          <details className="text-xs">
            <summary className="cursor-pointer">
              审核历史（{reviews.data.length}）
            </summary>
            <ol className="mt-2 space-y-2 pl-5">
              {reviews.data.map((review) => (
                <li key={review.id}>
                  <p className="font-medium">
                    第 {review.sequence_number} 次 ·{" "}
                    {review.decision === "approved" ? "审核通过" : "要求修改"} ·{" "}
                    {new Date(review.created_at).toLocaleString()}
                  </p>
                  <p className="text-muted-foreground break-all">
                    版本 SHA-256：{review.version_sha256}
                  </p>
                  <p className="whitespace-pre-wrap">{review.review_note}</p>
                  <p className="text-muted-foreground break-all">
                    审核成员：{review.reviewed_by_membership_id}
                  </p>
                </li>
              ))}
            </ol>
          </details>
        )}
      </div>
      {error ? (
        <p role="alert" className="p-4">
          {error}
        </p>
      ) : !content ? (
        <p role="status" className="p-4">
          正在核验并扫描所选版本…
        </p>
      ) : version.media_type === "application/json" &&
        (isGraph || isLegalGraphFile(version.original_filename)) ? (
        <LegalGraphPreview
          content={content.text ?? ""}
          scope={{ tenant_id: version.tenant_id, matter_id: version.matter_id }}
        />
      ) : version.media_type === "application/json" &&
        isLegalAuthoritiesFile(version.original_filename) ? (
        <LegalAuthoritiesPreview
          key={version.id}
          content={content.text ?? ""}
          scope={{ tenant_id: version.tenant_id, matter_id: version.matter_id }}
        />
      ) : version.media_type === "text/markdown" ? (
        <ArtifactFilePreview
          content={content.text ?? ""}
          language="markdown"
          scrollKey={version.id}
          externalLinksOnly
        />
      ) : isText ? (
        <pre className="min-h-0 flex-1 overflow-auto p-4 text-sm break-words whitespace-pre-wrap">
          {content.text}
        </pre>
      ) : ["image/png", "image/jpeg"].includes(version.media_type) ? (
        <div className="min-h-0 flex-1 overflow-auto p-3">
          <img
            src={content.url}
            alt={version.original_filename}
            className="max-w-full"
          />
        </div>
      ) : version.media_type === "application/pdf" ? (
        <iframe
          title={version.original_filename}
          src={content.url}
          sandbox=""
          className="min-h-0 w-full flex-1"
        />
      ) : (
        <p className="text-muted-foreground p-4 text-sm">
          此格式暂不支持内嵌预览，请下载此版本查看。
        </p>
      )}
      <Dialog
        open={reviewDialogOpen}
        onOpenChange={(open) => {
          if (!reviewMutation.isPending) setReviewDialogOpen(open);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>审核第 {version.version_number} 版</DialogTitle>
            <DialogDescription>
              审核记录将绑定此版本的 SHA-256。后续版本需要单独审核。
            </DialogDescription>
          </DialogHeader>
          <label className="space-y-2 text-sm">
            <span className="block">审核意见</span>
            <textarea
              aria-label="审核意见"
              className="border-input bg-background min-h-28 w-full rounded-md border px-3 py-2 text-sm"
              maxLength={8000}
              value={reviewNote}
              onChange={(event) => setReviewNote(event.target.value)}
            />
          </label>
          {reviewError && (
            <p role="alert" className="text-destructive text-sm">
              {reviewError}
            </p>
          )}
          <DialogFooter>
            <Button
              variant="ghost"
              disabled={reviewMutation.isPending}
              onClick={() => setReviewDialogOpen(false)}
            >
              取消
            </Button>
            <Button
              variant="outline"
              disabled={reviewMutation.isPending || !reviewNote.trim()}
              onClick={() => void submitReview("changes_requested")}
            >
              要求修改
            </Button>
            <Button
              disabled={reviewMutation.isPending || !reviewNote.trim()}
              onClick={() => void submitReview("approved")}
            >
              {reviewMutation.isPending ? "正在保存…" : "审核通过"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
