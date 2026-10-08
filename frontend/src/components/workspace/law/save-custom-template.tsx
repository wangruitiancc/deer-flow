"use client";

import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { BookCopyIcon } from "lucide-react";
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
  getMatter,
  getMatterContextByThread,
  useLawThreadContext,
} from "@/core/law";
import {
  isFormalProjectArtifact,
  loadProjectArtifactSource,
} from "@/core/law/artifact-source";
import {
  canWriteCustomTemplate,
  type CustomTemplate,
  getCustomTemplate,
  listCustomTemplates,
  MAX_CUSTOM_TEMPLATE_BYTES,
  saveCustomTemplate,
} from "@/core/law/custom-templates";

export function SaveCustomTemplate({
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
  const [name, setName] = useState(
    filepath.split("/").at(-1)?.replace(/\.md$/i, "") ?? "",
  );
  const [visibility, setVisibility] = useState<"private" | "shared">("private");
  const [targetId, setTargetId] = useState("new");
  const [selectedTarget, setSelectedTarget] = useState<CustomTemplate>();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const context = useLawThreadContext(open ? threadId : null);
  const scope = context.data;
  const queryClient = useQueryClient();
  const controller = useRef<AbortController | null>(null);
  const attempts = useRef(new Map<string, string>());
  const latest = useRef({
    blockedReason,
    open,
    threadId,
    filepath,
    scope,
    expectedSha256,
  });
  latest.current = {
    blockedReason,
    open,
    threadId,
    filepath,
    scope,
    expectedSha256,
  };
  useEffect(() => () => controller.current?.abort(), []);
  const items = useInfiniteQuery({
    queryKey: ["law", "custom-templates", scope?.tenant_id],
    initialPageParam: 0,
    queryFn: ({ pageParam, signal }) =>
      listCustomTemplates(scope!.tenant_id, pageParam, signal),
    getNextPageParam: (last, pages) =>
      last.length === 100 ? pages.length * 100 : undefined,
    enabled: open && Boolean(scope) && !context.isError,
    retry: false,
  });
  const options = [
    ...new Map(
      (items.data?.pages.flat() ?? []).map((item) => [item.id, item]),
    ).values(),
  ];
  const listedTarget = options.find((item) => item.id === targetId);
  const target = targetId === "new" ? undefined : selectedTarget;
  const unavailable =
    blockedReason ??
    (!expectedSha256 ? "请先完整加载当前 Markdown 文件。" : undefined) ??
    (!scope || context.isError || items.isError
      ? "模板或当前项目不可用，请重新核验。"
      : items.isPending
        ? "正在读取模板…"
        : targetId !== "new" && (!target || !listedTarget)
          ? "所选模板已不可用。"
          : target && listedTarget?.version !== target.version
            ? "模板目录已更新，请刷新并重新选择保存位置。"
            : !canWriteCustomTemplate(scope, target, visibility)
              ? "当前成员没有此模板的写入权限。"
              : undefined);

  function changeOpen(value: boolean) {
    if (!value) {
      controller.current?.abort();
      controller.current = null;
      setPending(false);
    }
    setOpen(value);
  }
  async function save() {
    if (pending || controller.current || unavailable || !scope) return;
    const active = new AbortController();
    controller.current = active;
    setPending(true);
    setError("");
    const assertCurrent = () => {
      active.signal.throwIfAborted();
      const current = latest.current;
      if (
        !current.open ||
        current.blockedReason ||
        current.threadId !== threadId ||
        current.filepath !== filepath ||
        current.expectedSha256 !== expectedSha256 ||
        current.scope?.mapping_id !== scope.mapping_id ||
        current.scope?.tenant_id !== scope.tenant_id
      )
        throw new Error("文件、会话或权限已变化，请重新确认。");
    };
    async function authorize() {
      const [fresh, project, selected] = await Promise.all([
        getMatterContextByThread(threadId, active.signal),
        getMatter(scope!.tenant_id, scope!.matter_id, active.signal),
        target
          ? getCustomTemplate(scope!.tenant_id, target.id, active.signal)
          : Promise.resolve(undefined),
      ]);
      assertCurrent();
      if (
        fresh.thread_id !== threadId ||
        fresh.tenant_id !== scope!.tenant_id ||
        fresh.matter_id !== scope!.matter_id ||
        fresh.mapping_id !== scope!.mapping_id ||
        project.status !== "active" ||
        !canWriteCustomTemplate(fresh, selected, visibility)
      )
        throw new Error("项目或模板权限已变化。");
      if (target && selected?.version !== target.version)
        throw new Error("模板已有更新，未覆盖；请刷新并重新选择。");
    }
    try {
      await authorize();
      const source = await loadProjectArtifactSource({
        threadId,
        filepath,
        expectedSha256,
        signal: active.signal,
        maxBytes: MAX_CUSTOM_TEMPLATE_BYTES,
        allowEmpty: true,
      });
      const content = new TextDecoder("utf-8", {
        fatal: true,
        ignoreBOM: true,
      }).decode(await source.file.arrayBuffer());
      await authorize();
      const title = target?.name ?? name.trim();
      const fingerprint = JSON.stringify([
        scope.tenant_id,
        threadId,
        filepath,
        source.sha256,
        title,
        visibility,
        target?.id,
        target?.version,
      ]);
      const key = attempts.current.get(fingerprint) ?? crypto.randomUUID();
      attempts.current.set(fingerprint, key);
      assertCurrent();
      const result = await saveCustomTemplate({
        tenantId: scope.tenant_id,
        name: title,
        content,
        visibility,
        target,
        idempotencyKey: key,
        signal: active.signal,
      });
      assertCurrent();
      toast.success(
        `已保存模板第 ${result.current_version_number} 版；不是项目定稿，也未安装为 Skill。`,
      );
      changeOpen(false);
      void queryClient.invalidateQueries({
        queryKey: ["law", "custom-templates", scope.tenant_id],
      });
    } catch (cause) {
      if (!active.signal.aborted)
        setError(
          cause instanceof Error
            ? cause.message
            : "保存结果未确认，请重试同一请求。",
        );
    } finally {
      if (controller.current === active) controller.current = null;
      if (!active.signal.aborted) setPending(false);
    }
  }
  if (!isFormalProjectArtifact(filepath) || !/\.md$/i.test(filepath))
    return null;
  return (
    <>
      <ArtifactAction
        icon={BookCopyIcon}
        label="保存为模板"
        tooltip={blockedReason ?? "保存为模板"}
        disabled={Boolean(blockedReason) || !expectedSha256}
        onClick={() => {
          setError("");
          changeOpen(true);
        }}
      />
      <Dialog open={open} onOpenChange={changeOpen}>
        <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-md">
          <DialogHeader>
            <DialogTitle>保存为模板</DialogTitle>
            <DialogDescription>
              使用当前已保存的 Markdown 原文（最多 64
              KiB），不会填充变量或修改文件。个人模板仅本人可见；组织模板对租户成员可见。
            </DialogDescription>
          </DialogHeader>
          {unavailable && (
            <p role="status" className="text-sm">
              {unavailable}
            </p>
          )}
          {error && (
            <p role="alert" className="text-destructive text-sm">
              {error}
            </p>
          )}
          <label htmlFor="law-template-destination">保存位置</label>
          <select
            id="law-template-destination"
            className="border-input bg-background focus-visible:ring-ring rounded-md border p-2 focus-visible:ring-2"
            value={targetId}
            disabled={pending}
            onChange={(event) => {
              setTargetId(event.target.value);
              setSelectedTarget(
                options.find((item) => item.id === event.target.value),
              );
            }}
          >
            <option value="new">创建新模板</option>
            <option value="" disabled>
              请重新选择保存位置
            </option>
            {options
              .filter((item) => scope && canWriteCustomTemplate(scope, item))
              .map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name} ·{" "}
                  {item.visibility === "private" ? "个人" : "组织"} · 第{" "}
                  {item.current_version_number} 版
                </option>
              ))}
          </select>
          {items.hasNextPage && (
            <Button
              variant="outline"
              disabled={pending || items.isFetchingNextPage}
              onClick={() => void items.fetchNextPage()}
            >
              加载更多模板
            </Button>
          )}
          {targetId === "new" && (
            <>
              <label htmlFor="law-custom-template-name">模板名称</label>
              <Input
                id="law-custom-template-name"
                maxLength={200}
                value={name}
                disabled={pending}
                onChange={(event) => setName(event.target.value)}
              />
              <label htmlFor="law-custom-template-visibility">可见范围</label>
              <select
                id="law-custom-template-visibility"
                className="border-input bg-background focus-visible:ring-ring rounded-md border p-2 focus-visible:ring-2"
                value={visibility}
                disabled={pending}
                onChange={(event) =>
                  setVisibility(event.target.value as "private" | "shared")
                }
              >
                <option value="private">个人模板（仅本人）</option>
                <option
                  value="shared"
                  disabled={
                    !scope || !["owner", "admin"].includes(scope.tenant_role)
                  }
                >
                  组织模板（管理员可创建）
                </option>
              </select>
            </>
          )}
          <p className="text-muted-foreground text-sm">
            保存将扫描正文并追加不可变版本，不会替换旧历史。请求结果不确定时可重试同一请求；关闭窗口不保证撤销已发出的保存。
          </p>
          <DialogFooter>
            <Button
              variant="outline"
              className="cursor-pointer"
              onClick={() => {
                if (pending) return;
                setTargetId("");
                setSelectedTarget(undefined);
                void items.refetch();
              }}
            >
              刷新目录
            </Button>
            <Button
              variant="outline"
              className="cursor-pointer"
              onClick={() => changeOpen(false)}
            >
              关闭
            </Button>
            <Button
              className="cursor-pointer"
              disabled={
                pending ||
                Boolean(unavailable) ||
                (targetId === "new" && !name.trim())
              }
              onClick={() => void save()}
            >
              {pending ? "正在保存…" : "保存模板版本"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
