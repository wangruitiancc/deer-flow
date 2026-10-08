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
  canWriteCustomTemplate,
  type CustomTemplate,
  type CustomTemplateVersion,
  getCustomTemplate,
  listCustomTemplateVersions,
  publishCustomTemplateCopy,
  readCustomTemplateVersion,
} from "@/core/law/custom-templates";

export function CustomTemplatePublish({
  threadId,
  source,
  sourceSelector,
  onBack,
  onClose,
}: {
  threadId: string;
  source: CustomTemplate;
  sourceSelector: ReactNode;
  onBack: () => void;
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
  const [version, setVersion] = useState<CustomTemplateVersion>();
  const [preview, setPreview] =
    useState<Awaited<ReturnType<typeof readCustomTemplateVersion>>>();
  const [name, setName] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const mounted = useRef(true);
  const controller = useRef<AbortController | null>(null);
  const attempts = useRef(new Map<string, string>());
  const scopeKey = JSON.stringify([
    threadId,
    scope?.tenant_id,
    scope?.matter_id,
    scope?.mapping_id,
    scope?.membership_id,
  ]);
  const selectionScope = useRef("");
  const latest = useRef({
    scopeKey,
    version,
    source,
    name,
    busy: thread.isLoading,
  });
  latest.current = { scopeKey, version, source, name, busy: thread.isLoading };
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      controller.current?.abort();
    };
  }, []);
  const permitted = Boolean(
    scope &&
    canWriteCustomTemplate(scope, source) &&
    canWriteCustomTemplate(scope, undefined, "shared"),
  );
  const blocked =
    isMock ||
    context.isError ||
    project.isError ||
    !permitted ||
    project.data?.status !== "active"
      ? "当前项目或共享权限不可用。仅当前租户管理员可发布本人个人模板或可读组织模板。"
      : thread.isLoading
        ? "请等待当前运行结束。"
        : version && selectionScope.current !== scopeKey
          ? "项目归属已变化，请返回管理目录重新选择。"
          : undefined;
  const versions = useInfiniteQuery({
    queryKey: ["law", "custom-template-versions", scope?.tenant_id, source.id],
    initialPageParam: 0,
    queryFn: ({ pageParam, signal }) =>
      listCustomTemplateVersions(
        source.tenant_id,
        source.id,
        pageParam,
        signal,
      ),
    getNextPageParam: (last, pages) =>
      last.length === 100 ? pages.length * 100 : undefined,
    enabled: permitted && !isMock && !context.isError,
    retry: false,
  });
  const items = [
    ...new Map(
      (versions.data?.pages.flat() ?? []).map((item) => [
        item.version_number,
        item,
      ]),
    ).values(),
  ];

  async function execute(publish: boolean) {
    if (
      !scope ||
      !version ||
      blocked ||
      pending ||
      controller.current ||
      (publish && (!preview || !confirmed || !name.trim()))
    )
      return;
    const current = new AbortController();
    controller.current = current;
    setPending(true);
    setError("");
    setSuccess("");
    if (!publish) {
      setPreview(undefined);
      setConfirmed(false);
    }
    const fingerprint = JSON.stringify([
      scopeKey,
      source.id,
      version.version_number,
      version.content_sha256,
      name.trim(),
    ]);
    const oldKey = attempts.current.get(fingerprint);
    let publicationAttempted = false;
    function assertCurrent() {
      current.signal.throwIfAborted();
      const now = latest.current;
      if (
        !mounted.current ||
        now.scopeKey !== scopeKey ||
        now.source !== source ||
        now.version !== version ||
        now.name !== name ||
        now.busy
      )
        throw new Error("选择或项目已变化，请重新预览确认。");
    }
    async function authorize() {
      try {
        const [freshScope, matter, fresh] = await Promise.all([
          getMatterContextByThread(threadId, current.signal),
          getMatter(scope!.tenant_id, scope!.matter_id, current.signal),
          getCustomTemplate(scope!.tenant_id, source.id, current.signal),
        ]);
        assertCurrent();
        if (
          freshScope.thread_id !== threadId ||
          freshScope.tenant_id !== scope!.tenant_id ||
          freshScope.matter_id !== scope!.matter_id ||
          freshScope.mapping_id !== scope!.mapping_id ||
          freshScope.membership_id !== scope!.membership_id ||
          matter.status !== "active" ||
          !canWriteCustomTemplate(freshScope, fresh) ||
          !canWriteCustomTemplate(freshScope, undefined, "shared")
        )
          throw new Error("项目、源模板或共享权限已变化。");
        if (!oldKey && fresh.version !== source.version)
          throw new Error(
            "源模板目录已有更新，请返回管理目录重新选择；未自动切换版本。",
          );
      } catch (cause) {
        if (mounted.current && !current.signal.aborted) {
          setPreview(undefined);
          setConfirmed(false);
        }
        throw cause;
      }
    }
    try {
      await authorize();
      const body = await readCustomTemplateVersion(
        scope.tenant_id,
        source.id,
        version.version_number,
        current.signal,
      );
      assertCurrent();
      if (
        body.version.id !== version.id ||
        body.version.content_sha256 !== version.content_sha256 ||
        body.version.byte_size !== version.byte_size
      )
        throw new Error("所选历史版本与预览摘要不一致，请重新选择。");
      await authorize();
      if (!publish) {
        setPreview(body);
        return;
      }
      if (body.content !== preview!.content)
        throw new Error("预览正文已变化，请重新确认。");
      const key = oldKey ?? crypto.randomUUID();
      attempts.current.set(fingerprint, key);
      publicationAttempted = true;
      const receipt = await publishCustomTemplateCopy({
        tenantId: scope.tenant_id,
        source,
        versionNumber: version.version_number,
        name,
        idempotencyKey: key,
        signal: current.signal,
      });
      assertCurrent();
      const copy = await readCustomTemplateVersion(
        scope.tenant_id,
        receipt.template_id,
        1,
        current.signal,
      );
      assertCurrent();
      if (
        copy.content !== body.content ||
        copy.version.content_sha256 !== version.content_sha256 ||
        copy.version.byte_size !== version.byte_size
      )
        throw new Error(
          "发布可能已提交，但副本回读不一致；结果未确认，请用原请求重试核验。",
        );
      setSuccess(
        "已发布组织副本并核对第一版正文。此次未改变原模板可见范围，也未复制其他历史版本；可返回目录查看新副本。",
      );
      setConfirmed(false);
      setPreview(undefined);
      setVersion(undefined);
      setName("");
      void client.invalidateQueries({
        queryKey: ["law", "custom-templates", scope.tenant_id],
      });
    } catch (cause) {
      if (mounted.current && !current.signal.aborted) {
        if (!publicationAttempted) {
          setPreview(undefined);
          setConfirmed(false);
        }
        setError(
          `${publicationAttempted ? "发布结果未确认，服务端可能已提交；可用同一请求重试核验。" : ""}${cause instanceof Error ? cause.message : "请重试或返回重新读取。"}`,
        );
      }
    } finally {
      if (controller.current === current) controller.current = null;
      if (mounted.current && !current.signal.aborted) setPending(false);
    }
  }
  return (
    <DialogContent className="flex max-h-[85dvh] flex-col overflow-hidden sm:max-w-lg">
      <DialogHeader className="shrink-0">
        <DialogTitle>发布组织模板副本</DialogTitle>
        <DialogDescription>
          当前项目：{project.data?.title ?? "正在核验"}
          。只复制明确选择的一版，不改变原模板可见范围。
        </DialogDescription>
      </DialogHeader>
      <div className="shrink-0">{sourceSelector}</div>
      <div className="min-h-0 space-y-3 overflow-y-auto px-1">
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
        <p className="text-sm break-all">
          源模板：{source.name} ·{" "}
          {source.visibility === "private" ? "个人" : "组织"}
        </p>
        {versions.isError && (
          <p role="alert">版本目录读取失败，请返回后重新读取。</p>
        )}
        {versions.isFetching && <p role="status">正在读取版本目录…</p>}
        <label htmlFor="template-publish-version">要共享的正文版本</label>
        <select
          id="template-publish-version"
          className="border-input bg-background w-full rounded-md border p-2"
          value={version?.version_number ?? ""}
          disabled={pending || Boolean(blocked) || versions.isError}
          onChange={(event) => {
            setVersion(
              items.find(
                (item) => item.version_number === Number(event.target.value),
              ),
            );
            selectionScope.current = scopeKey;
            setPreview(undefined);
            setConfirmed(false);
            setError("");
            setSuccess("");
          }}
        >
          <option value="">请明确选择版本</option>
          {items.map((item) => (
            <option key={item.version_number} value={item.version_number}>
              第 {item.version_number} 版 · {item.byte_size} 字节
            </option>
          ))}
        </select>
        {versions.hasNextPage && (
          <Button
            variant="outline"
            disabled={pending || versions.isFetching}
            onClick={() => void versions.fetchNextPage()}
          >
            加载更多版本
          </Button>
        )}
        <Button
          variant="outline"
          disabled={pending || Boolean(blocked) || !version}
          onClick={() => void execute(false)}
        >
          读取所选版本预览
        </Button>
        {preview && !blocked && (
          <pre
            aria-label="待共享正文"
            className="bg-muted max-h-48 overflow-auto rounded-md p-3 text-xs break-all whitespace-pre-wrap"
          >
            {preview.content || "（空模板）"}
          </pre>
        )}
        <label htmlFor="template-publish-name">组织副本名称</label>
        <Input
          id="template-publish-name"
          value={name}
          disabled={pending || Boolean(blocked)}
          onChange={(event) => {
            setName(event.target.value);
            setConfirmed(false);
            setError("");
          }}
        />
        <p className="text-sm">
          发布后，此版本正文将对当前租户有模板读取权限的成员可见。请人工确认已去除客户姓名、案件事实等私密内容；本系统不会自动脱敏。同名冲突不覆盖已有模板。
        </p>
        <label className="flex cursor-pointer items-start gap-2 text-sm">
          <input
            type="checkbox"
            className="mt-1"
            checked={confirmed}
            disabled={!preview || pending || Boolean(blocked)}
            onChange={(event) => setConfirmed(event.target.checked)}
          />
          我已预览所选正文并核对隐私，确认发布组织副本
        </label>
        <p className="text-muted-foreground text-xs">
          不会启动 Agent、安装 Skill
          或保存项目成果。关闭不保证撤销已发送发布；同一窗口重试保留原请求，重新打开不保证去重。
        </p>
      </div>
      {version && (
        <p
          className="shrink-0 text-sm"
          aria-label="待共享版本"
          title={`${source.name} · 第 ${version.version_number} 版 → ${name || "未命名副本"}`}
        >
          <span className="block truncate">
            第 {version.version_number} 版 · {source.name}
          </span>
          <span className="block truncate">
            组织副本：{name || "未命名副本"}
          </span>
        </p>
      )}
      <DialogFooter className="shrink-0">
        <Button variant="outline" onClick={onBack}>
          返回管理
        </Button>
        <Button variant="outline" onClick={onClose}>
          关闭
        </Button>
        <Button
          disabled={
            pending ||
            Boolean(blocked) ||
            !version ||
            !preview ||
            !confirmed ||
            !name.trim()
          }
          onClick={() => void execute(true)}
        >
          {pending ? "正在核验…" : "确认发布副本"}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
