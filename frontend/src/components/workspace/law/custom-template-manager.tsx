"use client";

import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { type ReactNode, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useThread } from "@/components/workspace/messages/context";
import {
  getMatter,
  getMatterContextByThread,
  useLawMatter,
  useLawThreadContext,
} from "@/core/law";
import {
  canManageCustomTemplate,
  canWriteCustomTemplate,
  changeCustomTemplateMetadata,
  type CustomTemplate,
  getCustomTemplate,
  listCustomTemplates,
  type TemplateMetadataChange,
} from "@/core/law/custom-templates";

import { CustomTemplateCreate } from "./custom-template-create";
import { CustomTemplatePublish } from "./custom-template-publish";

export function CustomTemplateManager({
  threadId,
  sourceSelector,
  onClose,
}: {
  threadId: string;
  sourceSelector: ReactNode;
  onClose: () => void;
}) {
  const { thread, isMock } = useThread();
  const context = useLawThreadContext(threadId);
  const scope = context.data;
  const project = useLawMatter(
    scope?.tenant_id ?? null,
    scope?.matter_id ?? null,
  );
  const client = useQueryClient();
  const [filter, setFilter] = useState<"active" | "archived">("active");
  const [selected, setSelected] = useState<CustomTemplate>();
  const [name, setName] = useState("");
  const [action, setAction] = useState<"rename" | "archive" | "restore">(
    "rename",
  );
  const [confirmed, setConfirmed] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [publishing, setPublishing] = useState<CustomTemplate>();
  const [creating, setCreating] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const attempts = useRef(new Map<string, string>());
  const selectionScope = useRef("");
  const mounted = useRef(true);
  const scopeKey = JSON.stringify([
    threadId,
    scope?.tenant_id,
    scope?.matter_id,
    scope?.mapping_id,
    scope?.membership_id,
  ]);
  const latest = useRef({
    threadId,
    scopeKey,
    selected,
    name,
    action,
    busy: thread.isLoading,
  });
  latest.current = {
    threadId,
    scopeKey,
    selected,
    name,
    action,
    busy: thread.isLoading,
  };
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      controller.current?.abort();
    };
  }, []);
  const catalog = useInfiniteQuery({
    queryKey: [
      "law",
      "custom-templates",
      scope?.tenant_id,
      "including-archived",
    ],
    initialPageParam: 0,
    queryFn: ({ pageParam, signal }) =>
      listCustomTemplates(scope!.tenant_id, pageParam, signal, true),
    getNextPageParam: (last, pages) =>
      last.length === 100 ? pages.length * 100 : undefined,
    enabled: Boolean(scope) && !context.isError && !isMock,
    retry: false,
  });
  const items = [
    ...new Map(
      (catalog.data?.pages.flat() ?? []).map((item) => [item.id, item]),
    ).values(),
  ];
  const listed = items.find((item) => item.id === selected?.id);
  const blocked =
    isMock ||
    context.isError ||
    project.isError ||
    !scope ||
    project.data?.status !== "active"
      ? "当前项目不可用或仍在核验。"
      : thread.isLoading
        ? "请等待当前运行结束。"
        : selected && selectionScope.current !== scopeKey
          ? "项目归属已变化，请重新选择模板。"
          : selected && !canManageCustomTemplate(scope, selected)
            ? "此模板只读：个人模板仅本人可管理，组织模板需管理员。"
            : undefined;
  function clearSelection() {
    setSelected(undefined);
    setConfirmed(false);
    setError("");
  }
  function choose(item?: CustomTemplate) {
    setSelected(item);
    setName(item?.name ?? "");
    setAction(item?.status === "archived" ? "restore" : "rename");
    selectionScope.current = scopeKey;
    setConfirmed(false);
    setError("");
    setSuccess("");
  }
  async function mutate() {
    if (
      !scope ||
      !selected ||
      pending ||
      controller.current ||
      blocked ||
      !confirmed
    )
      return;
    const current = new AbortController();
    controller.current = current;
    setPending(true);
    setError("");
    setSuccess("");
    const change: TemplateMetadataChange =
      action === "rename"
        ? { name: name.trim() }
        : { status: action === "archive" ? "archived" : "active" };
    const fingerprint = JSON.stringify([
      scopeKey,
      selected.id,
      selected.version,
      change,
    ]);
    const previousKey = attempts.current.get(fingerprint);
    function assertCurrent() {
      current.signal.throwIfAborted();
      const now = latest.current;
      if (
        !mounted.current ||
        now.threadId !== threadId ||
        now.scopeKey !== scopeKey ||
        now.selected !== selected ||
        now.name !== name ||
        now.action !== action ||
        now.busy
      )
        throw new Error("操作对象或项目已变化，请重新确认。");
    }
    try {
      const [freshScope, matter, fresh] = await Promise.all([
        getMatterContextByThread(threadId, current.signal),
        getMatter(scope.tenant_id, scope.matter_id, current.signal),
        getCustomTemplate(scope.tenant_id, selected.id, current.signal),
      ]);
      assertCurrent();
      if (
        freshScope.thread_id !== threadId ||
        freshScope.tenant_id !== scope.tenant_id ||
        freshScope.matter_id !== scope.matter_id ||
        freshScope.mapping_id !== scope.mapping_id ||
        freshScope.membership_id !== scope.membership_id ||
        matter.status !== "active" ||
        !canManageCustomTemplate(freshScope, fresh)
      )
        throw new Error("项目或模板权限已变化。");
      if (!previousKey && fresh.version !== selected.version)
        throw new Error("模板已有更新，请重新读取并选择；没有覆盖新版本。");
      const key = previousKey ?? crypto.randomUUID();
      attempts.current.set(fingerprint, key);
      await changeCustomTemplateMetadata({
        tenantId: scope.tenant_id,
        target: selected,
        change,
        idempotencyKey: key,
        signal: current.signal,
      });
      assertCurrent();
      setSuccess(
        "已确认本次操作提交，历史正文版本保持不变。请按刷新后的目录查看当前状态。",
      );
      clearSelection();
      void client.invalidateQueries({
        queryKey: ["law", "custom-templates", scope.tenant_id],
      });
    } catch (cause) {
      if (mounted.current && !current.signal.aborted)
        setError(
          cause instanceof Error
            ? cause.message
            : "操作结果未确认，请重试同一请求。",
        );
    } finally {
      if (controller.current === current) controller.current = null;
      if (mounted.current && !current.signal.aborted) setPending(false);
    }
  }
  if (creating)
    return (
      <CustomTemplateCreate
        key={threadId}
        threadId={threadId}
        sourceSelector={sourceSelector}
        onBack={() => {
          setCreating(false);
          clearSelection();
        }}
        onClose={onClose}
      />
    );
  if (publishing)
    return (
      <CustomTemplatePublish
        key={`${threadId}:${publishing.id}`}
        threadId={threadId}
        source={publishing}
        sourceSelector={sourceSelector}
        onBack={() => {
          setPublishing(undefined);
          clearSelection();
        }}
        onClose={onClose}
      />
    );
  return (
    <DialogContent className="flex max-h-[85dvh] flex-col overflow-hidden sm:max-w-lg">
      <DialogHeader className="shrink-0">
        <DialogTitle>管理自定义模板</DialogTitle>
        <DialogDescription>
          当前项目：{project.data?.title ?? "正在核验"}
          。管理当前租户的模板目录；不改变正文历史、不启动 Agent。
        </DialogDescription>
      </DialogHeader>
      <div className="shrink-0">{sourceSelector}</div>
      <div className="min-h-0 space-y-3 overflow-y-auto px-1">
        <Button
          variant="outline"
          disabled={
            pending ||
            Boolean(isMock) ||
            context.isError ||
            project.isError ||
            project.data?.status !== "active" ||
            thread.isLoading ||
            !scope ||
            !canWriteCustomTemplate(scope)
          }
          onClick={() => setCreating(true)}
        >
          新建空白模板
        </Button>
        {blocked && (
          <p role="status" className="text-sm">
            {blocked}
          </p>
        )}
        {error && (
          <p role="alert" className="text-destructive text-sm">
            {error}
          </p>
        )}
        {success && (
          <p role="status" className="text-sm">
            {success}
          </p>
        )}
        <label htmlFor="template-manager-filter">目录范围</label>
        <select
          id="template-manager-filter"
          value={filter}
          disabled={pending}
          className="border-input bg-background w-full rounded-md border p-2"
          onChange={(event) => {
            setFilter(event.target.value as "active" | "archived");
            clearSelection();
          }}
        >
          <option value="active">可用模板</option>
          <option value="archived">已归档模板</option>
        </select>
        {catalog.isError && (
          <p role="alert">
            模板目录读取失败，请重新读取；不代表之前提交的操作已撤销。
          </p>
        )}
        {catalog.isFetching && <p role="status">正在读取目录…</p>}
        <label htmlFor="template-manager-target">管理对象</label>
        <select
          id="template-manager-target"
          value={selected?.id ?? ""}
          disabled={pending || catalog.isError || catalog.isFetching}
          className="border-input bg-background w-full rounded-md border p-2"
          onChange={(event) =>
            choose(items.find((item) => item.id === event.target.value))
          }
        >
          <option value="">请选择模板</option>
          {items
            .filter((item) => item.status === filter)
            .map((item) => (
              <option key={item.id} value={item.id}>
                {item.name} · {item.visibility === "private" ? "个人" : "组织"}{" "}
                · 正文第 {item.current_version_number} 版
              </option>
            ))}
        </select>
        {catalog.hasNextPage && (
          <Button
            variant="outline"
            disabled={pending || catalog.isFetching}
            onClick={() => void catalog.fetchNextPage()}
          >
            加载更多模板
          </Button>
        )}
        {selected && (
          <>
            <p className="text-muted-foreground text-sm break-all">
              已选：{selected.name}；目录修订 {selected.version}，正文版本{" "}
              {selected.current_version_number}。
            </p>
            {listed?.version !== selected.version && (
              <p className="text-sm">
                目录已变化，选择仍固定旧修订。请重新读取；若上次结果未确认，可重试原操作由服务端核验。
              </p>
            )}
            <label htmlFor="template-manager-action">操作</label>
            <select
              id="template-manager-action"
              value={action}
              disabled={pending || Boolean(blocked)}
              className="border-input bg-background w-full rounded-md border p-2"
              onChange={(event) => {
                setAction(event.target.value as typeof action);
                setConfirmed(false);
                setError("");
              }}
            >
              {selected.status === "active" ? (
                <>
                  <option value="rename">重命名</option>
                  <option value="archive">归档（可恢复）</option>
                </>
              ) : (
                <option value="restore">恢复为可用模板</option>
              )}
            </select>
            {action === "rename" && (
              <>
                <label htmlFor="template-manager-name">新名称</label>
                <Input
                  id="template-manager-name"
                  value={name}
                  disabled={pending || Boolean(blocked)}
                  onChange={(event) => {
                    setName(event.target.value);
                    setConfirmed(false);
                  }}
                />
              </>
            )}
            <p className="text-sm">
              {action === "archive"
                ? "归档后不再出现在起草目录，不能继续打开生成；历史版本和已有成果保留，可在已归档目录恢复。"
                : action === "restore"
                  ? "恢复不会覆盖同名可用模板；名称冲突时保持归档，请先处理冲突模板。"
                  : "只修改目录名称，已有正文、历史版本和项目成果不会改名或重写。"}
            </p>
            {scope &&
              selected.status === "active" &&
              canManageCustomTemplate(scope, selected) &&
              canWriteCustomTemplate(scope, undefined, "shared") && (
                <Button
                  variant="outline"
                  disabled={pending || Boolean(blocked)}
                  onClick={() => setPublishing(selected)}
                >
                  选版发布组织副本
                </Button>
              )}
            <label className="flex cursor-pointer items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-1"
                checked={confirmed}
                disabled={pending || Boolean(blocked)}
                onChange={(event) => setConfirmed(event.target.checked)}
              />
              我已核对模板及操作影响，确认执行
            </label>
          </>
        )}
        <p className="text-muted-foreground text-xs">
          正文编辑请返回自定义模板选择，打开到右侧原生编辑器。此处只管理目录；关闭不保证撤销已发送请求，同一窗口可用原请求重试。
        </p>
      </div>
      {selected && (
        <p
          className="shrink-0 truncate text-sm"
          aria-label="待确认操作"
          title={`${action === "rename" ? "重命名" : action === "archive" ? "归档" : "恢复"}：${selected.name}${action === "rename" ? ` → ${name}` : ""}`}
        >
          {action === "rename"
            ? "重命名"
            : action === "archive"
              ? "归档"
              : "恢复"}
          ：{selected.name}
          {action === "rename" ? ` → ${name}` : ""}
        </p>
      )}
      <DialogFooter className="shrink-0">
        <Button
          variant="outline"
          disabled={pending}
          onClick={() => {
            clearSelection();
            void catalog.refetch();
          }}
        >
          重新读取
        </Button>
        <Button variant="outline" onClick={onClose}>
          关闭
        </Button>
        <Button
          disabled={
            pending ||
            Boolean(blocked) ||
            !selected ||
            !confirmed ||
            (action === "rename" &&
              (!name.trim() || name.trim() === selected.name))
          }
          onClick={() => void mutate()}
        >
          {pending ? "正在核验…" : "确认执行"}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
