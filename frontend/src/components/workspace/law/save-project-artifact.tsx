"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FolderPlusIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { ArtifactAction } from "@/components/ai-elements/artifact";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  listProjectArtifacts,
  saveProjectArtifact,
  useLawThreadContext,
  useLawMatter,
  useLawProjectArtifactVersions,
  type ProjectArtifactKind,
} from "@/core/law";
import {
  isFormalProjectArtifact,
  loadProjectArtifactSource,
} from "@/core/law/artifact-source";
import {
  isLegalAuthoritiesFile,
  MAX_LEGAL_AUTHORITIES_BYTES,
  parseLegalAuthorities,
} from "@/core/law/legal-authorities";
import {
  isLegalGraphFile,
  MAX_LEGAL_GRAPH_BYTES,
  parseLegalGraph,
} from "@/core/law/legal-graph";
import { loadLegalTemplateCatalog } from "@/core/law/templates";

const kinds: Array<[ProjectArtifactKind, string]> = [
  ["document", "法律文书"],
  ["note", "项目笔记"],
  ["legal_research", "法律研究"],
  ["contract_review", "合同审查"],
  ["transcript", "录音转写"],
  ["knowledge_graph", "案情图谱"],
  ["other", "其他法律成果"],
];

export function SaveProjectArtifact({
  threadId,
  filepath,
  expectedSha256,
  blockedReason,
}: {
  threadId: string;
  filepath: string;
  expectedSha256?: string;
  blockedReason?: string;
}) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(filepath.split("/").at(-1) ?? "");
  const [kind, setKind] = useState<ProjectArtifactKind>(
    isLegalGraphFile(filepath)
      ? "knowledge_graph"
      : isLegalAuthoritiesFile(filepath)
        ? "legal_research"
        : "document",
  );
  const [targetId, setTargetId] = useState("new");
  const [strategyVersionId, setStrategyVersionId] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const controller = useRef<AbortController | null>(null);
  const attempts = useRef(new Map<string, string>());
  const queryClient = useQueryClient();
  const context = useLawThreadContext(open ? threadId : null);
  const scope = context.data;
  const project = useLawMatter(
    open ? (scope?.tenant_id ?? null) : null,
    open ? (scope?.matter_id ?? null) : null,
  );
  const queryKey = [
    "law",
    "project-artifacts",
    scope?.tenant_id,
    scope?.matter_id,
  ];
  const items = useQuery({
    queryKey,
    queryFn: ({ signal }) =>
      listProjectArtifacts(scope!.tenant_id, scope!.matter_id, signal),
    enabled: open && Boolean(scope) && !context.isError,
    retry: false,
  });
  const target = items.data?.find((item) => item.id === targetId);
  const strategyArtifact = items.data?.find(
    (item) => item.kind === "litigation_strategy" && item.status === "active",
  );
  const strategyVersions = useLawProjectArtifactVersions(
    scope?.tenant_id ?? "",
    scope?.matter_id ?? "",
    strategyArtifact?.id ?? null,
  );
  const templateCatalog = useQuery({
    queryKey: ["law", "template-catalog", "save", threadId],
    queryFn: ({ signal }) => loadLegalTemplateCatalog(signal),
    enabled: open && filepath.toLowerCase().endsWith(".md"),
    retry: false,
  });
  const selectedTemplate = templateCatalog.data?.templates.find(
    (item) => item.id === templateId,
  );
  const permitted =
    scope && ["owner", "lead", "lawyer"].includes(scope.matter_role);
  const unavailable =
    blockedReason ??
    (!project.data || project.isError
      ? "正在核验目标项目，或项目已不可用。"
      : undefined) ??
    (!permitted
      ? "正在核验项目权限，或当前成员无保存权限。"
      : items.isPending
        ? "正在加载项目成果…"
        : items.isError
          ? "无法加载项目成果，请稍后重试。"
          : targetId !== "new" && !target
            ? "所选成果已不可用，请重新选择。"
            : undefined);

  useEffect(() => () => controller.current?.abort(), []);

  async function save() {
    if (pending || unavailable || !scope || (!target && !title.trim())) return;
    const active = new AbortController();
    controller.current = active;
    setPending(true);
    setError("");
    try {
      const current = await context.refetch();
      if (
        current.isError ||
        current.data?.tenant_id !== scope.tenant_id ||
        current.data.matter_id !== scope.matter_id
      ) {
        throw new Error("项目归属或权限已变化，请重新打开成果。");
      }
      const source = await loadProjectArtifactSource({
        threadId,
        filepath,
        expectedSha256,
        signal: active.signal,
      });
      const name = target?.title ?? title.trim();
      const artifactKind = target?.kind ?? kind;
      if (
        isLegalAuthoritiesFile(filepath) ||
        isLegalAuthoritiesFile(source.file.name)
      ) {
        if (
          artifactKind !== "legal_research" ||
          !isLegalAuthoritiesFile(filepath) ||
          !isLegalAuthoritiesFile(source.file.name)
        )
          throw new Error(
            "法律依据须保存为法律研究，且源文件与文件名均须保留 .law-authorities.json 后缀。",
          );
        if (source.file.size > MAX_LEGAL_AUTHORITIES_BYTES)
          throw new Error("法律依据文件不能超过 2 MiB。");
        await parseLegalAuthorities(
          new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
            await source.file.arrayBuffer(),
          ),
        );
        active.signal.throwIfAborted();
      }
      if (artifactKind === "knowledge_graph") {
        if (source.file.size > MAX_LEGAL_GRAPH_BYTES)
          throw new Error("图谱文件不能超过 2 MiB。");
        parseLegalGraph(
          new TextDecoder("utf-8", { fatal: true }).decode(
            await source.file.arrayBuffer(),
          ),
        );
        active.signal.throwIfAborted();
      }
      const fingerprint = JSON.stringify([
        scope.tenant_id,
        scope.matter_id,
        threadId,
        filepath,
        source.sha256,
        name,
        artifactKind,
        target?.id,
        target?.version,
        strategyVersionId,
        selectedTemplate?.id,
        selectedTemplate?.source_sha256,
      ]);
      const key = attempts.current.get(fingerprint) ?? crypto.randomUUID();
      attempts.current.set(fingerprint, key);
      const result = await saveProjectArtifact({
        tenantId: scope.tenant_id,
        matterId: scope.matter_id,
        threadId,
        filepath,
        ...source,
        title: name,
        kind: artifactKind,
        artifactId: target?.id,
        expectedVersion: target?.version,
        derivedFromVersionId: strategyVersionId || undefined,
        templateId: selectedTemplate?.id,
        templateSha256: selectedTemplate?.source_sha256,
        idempotencyKey: key,
        signal: active.signal,
      });
      if (active.signal.aborted) return;
      toast.success(
        `已保存为项目成果 · 第 ${result.artifact_version.version_number} 版（未审核）`,
      );
      setOpen(false);
      void queryClient.invalidateQueries({
        queryKey: [
          "law",
          "project-artifacts",
          scope.tenant_id,
          scope.matter_id,
        ],
      });
    } catch (cause) {
      if (!active.signal.aborted)
        setError(
          cause instanceof Error
            ? cause.message
            : "保存结果未确认，请重试同一请求。",
        );
    } finally {
      if (!active.signal.aborted) setPending(false);
    }
  }

  if (!isFormalProjectArtifact(filepath)) return null;
  return (
    <>
      <ArtifactAction
        icon={FolderPlusIcon}
        label="保存到项目"
        tooltip={blockedReason ?? "保存到项目"}
        disabled={Boolean(blockedReason)}
        onClick={() => {
          setError("");
          setOpen(true);
        }}
      />
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!pending) setOpen(next);
        }}
      >
        <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>保存到当前法律项目</DialogTitle>
            <DialogDescription>
              保留独立版本，其他有权限的项目成员可以查看。保存不代表审核或定稿。
            </DialogDescription>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              void save();
            }}
          >
            <p className="text-muted-foreground text-sm break-all">
              目标项目：{project.data?.title ?? "加载中…"}
            </p>
            <p className="text-muted-foreground text-sm break-all">
              来源文件：{filepath.split("/").at(-1)}
            </p>
            <label className="block space-y-2 text-sm">
              <span>保存位置</span>
              <select
                aria-label="保存位置"
                className="bg-background w-full rounded-md border p-2"
                value={targetId}
                disabled={pending || items.isPending || items.isError}
                onChange={(event) => setTargetId(event.target.value)}
              >
                <option value="new">新建项目成果</option>
                {items.data
                  ?.filter((item) => item.status === "active")
                  .map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.title} · 追加第 {item.current_version_number + 1} 版
                    </option>
                  ))}
              </select>
            </label>
            {targetId === "new" ? (
              <>
                <label className="block space-y-2 text-sm">
                  <span>成果名称</span>
                  <Input
                    value={title}
                    required
                    maxLength={240}
                    disabled={pending}
                    onChange={(event) => setTitle(event.target.value)}
                  />
                </label>
                <label className="block space-y-2 text-sm">
                  <span>成果类型</span>
                  <select
                    aria-label="成果类型"
                    className="bg-background w-full rounded-md border p-2"
                    value={kind}
                    disabled={pending}
                    onChange={(event) =>
                      setKind(event.target.value as ProjectArtifactKind)
                    }
                  >
                    {kinds.map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
              </>
            ) : (
              <p className="text-muted-foreground text-sm">
                新版本不会覆盖旧版本。若其他成员已更新，保存将被拒绝；请重新打开并确认最新版本。
              </p>
            )}
            {filepath.toLowerCase().endsWith(".md") &&
              (target?.kind ?? kind) === "document" && (
                <div className="space-y-3 rounded-md border p-3">
                  <p className="text-sm font-medium">固定文书来源（可选）</p>
                  <label className="block space-y-2 text-sm">
                    <span>诉讼策略版本</span>
                    <select
                      aria-label="诉讼策略版本"
                      className="bg-background w-full rounded-md border p-2"
                      value={strategyVersionId}
                      disabled={pending || strategyVersions.isPending}
                      onChange={(event) =>
                        setStrategyVersionId(event.target.value)
                      }
                    >
                      <option value="">不绑定策略版本</option>
                      {strategyVersions.data?.map((version) => (
                        <option key={version.id} value={version.id}>
                          V{version.version_number} · {version.review_status}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="block space-y-2 text-sm">
                    <span>内置模板版本</span>
                    <select
                      aria-label="内置模板版本"
                      className="bg-background w-full rounded-md border p-2"
                      value={templateId}
                      disabled={
                        pending ||
                        templateCatalog.isPending ||
                        templateCatalog.isError
                      }
                      onChange={(event) => setTemplateId(event.target.value)}
                    >
                      <option value="">不绑定内置模板</option>
                      {templateCatalog.data?.templates
                        .filter((item) => item.artifact_kind === "document")
                        .map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.title} · {item.source_sha256.slice(0, 12)}
                          </option>
                        ))}
                    </select>
                  </label>
                  {templateCatalog.isError && (
                    <p role="status" className="text-muted-foreground text-xs">
                      模板目录暂不可用；可保存普通草稿，不会伪造模板版本。
                    </p>
                  )}
                </div>
              )}
            <p className="text-muted-foreground text-xs">
              将读取当前完整文件并检查内容指纹。来源为客户端提交，尚未独立核验原始出处。
            </p>
            {unavailable && (
              <p role="status" className="text-muted-foreground text-sm">
                {unavailable}
              </p>
            )}
            {error && (
              <p role="alert" className="text-destructive text-sm">
                {error}
              </p>
            )}
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                disabled={pending}
                onClick={() => setOpen(false)}
              >
                取消
              </Button>
              <Button
                type="submit"
                disabled={
                  pending || Boolean(unavailable) || (!target && !title.trim())
                }
              >
                {pending ? "正在读取、扫描并保存…" : "保存未审核版本"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
