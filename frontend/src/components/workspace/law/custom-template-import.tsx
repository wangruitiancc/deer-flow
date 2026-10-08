"use client";

import { useQueryClient } from "@tanstack/react-query";
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
  previewTemplateImport,
  type TemplateImportPreview,
} from "@/core/law/custom-template-import";
import {
  canWriteCustomTemplate,
  readCustomTemplateVersion,
  saveCustomTemplate,
} from "@/core/law/custom-templates";

export function CustomTemplateImport({
  threadId,
  onClose,
  sourceSelector,
}: {
  threadId: string;
  onClose: () => void;
  sourceSelector: ReactNode;
}) {
  const { thread, isMock } = useThread();
  const context = useLawThreadContext(threadId);
  const scope = context.data;
  const project = useLawMatter(
    scope?.tenant_id ?? null,
    scope?.matter_id ?? null,
  );
  const client = useQueryClient();
  const [preview, setPreview] = useState<TemplateImportPreview>();
  const [name, setName] = useState("");
  const [visibility, setVisibility] = useState<"private" | "shared">("private");
  const [confirmed, setConfirmed] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const active = useRef<AbortController | null>(null);
  const attempts = useRef(new Map<string, string>());
  const mounted = useRef(true);
  const sourceScope = useRef("");
  const scopeKey = JSON.stringify([
    threadId,
    scope?.tenant_id,
    scope?.matter_id,
    scope?.mapping_id,
    scope?.membership_id,
  ]);
  const blocked =
    isMock ||
    context.isError ||
    project.isError ||
    !scope ||
    project.data?.status !== "active"
      ? "当前项目不可用或仍在核验。"
      : preview && sourceScope.current !== scopeKey
        ? "项目归属已变化，请重新选择原文件。"
        : thread.isLoading
          ? "请等待当前运行结束。"
          : !canWriteCustomTemplate(scope, undefined, visibility)
            ? "当前成员没有此范围的模板写入权限。"
            : undefined;
  const latest = useRef({
    threadId,
    scope,
    blocked,
    preview,
    name,
    visibility,
    confirmed,
  });
  latest.current = {
    threadId,
    scope,
    blocked,
    preview,
    name,
    visibility,
    confirmed,
  };
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      active.current?.abort();
    };
  }, []);

  async function selectFile(file?: File) {
    if (isMock || !scope) return;
    active.current?.abort();
    const controller = new AbortController();
    active.current = controller;
    sourceScope.current = scopeKey;
    setPreview(undefined);
    setConfirmed(false);
    setSaved(false);
    setError("");
    setPending(Boolean(file));
    if (!file) {
      active.current = null;
      return;
    }
    try {
      const result = await previewTemplateImport(file, controller.signal);
      if (!mounted.current || active.current !== controller) return;
      setPreview(result);
      setName(result.suggestedName);
      setVisibility("private");
    } catch (cause) {
      if (mounted.current && !controller.signal.aborted)
        setError(
          cause instanceof Error ? cause.message : "文件读取失败，请重新选择。",
        );
    } finally {
      if (active.current === controller) {
        active.current = null;
        if (mounted.current) setPending(false);
      }
    }
  }
  async function save() {
    if (active.current || blocked || !scope || !preview || !confirmed || saved)
      return;
    const controller = new AbortController();
    active.current = controller;
    setPending(true);
    setError("");
    function assertCurrent() {
      controller.signal.throwIfAborted();
      const current = latest.current;
      if (
        !mounted.current ||
        current.blocked ||
        current.threadId !== threadId ||
        current.scope?.tenant_id !== scope!.tenant_id ||
        current.scope?.matter_id !== scope!.matter_id ||
        current.scope?.mapping_id !== scope!.mapping_id ||
        current.preview !== preview ||
        current.name !== name ||
        current.visibility !== visibility ||
        !current.confirmed
      )
        throw new Error("文件、目标或权限已变化，请重新确认。");
    }
    try {
      const [fresh, matter] = await Promise.all([
        getMatterContextByThread(threadId, controller.signal),
        getMatter(scope.tenant_id, scope.matter_id, controller.signal),
      ]);
      assertCurrent();
      if (
        fresh.thread_id !== threadId ||
        fresh.tenant_id !== scope.tenant_id ||
        fresh.matter_id !== scope.matter_id ||
        fresh.mapping_id !== scope.mapping_id ||
        fresh.membership_id !== scope.membership_id ||
        matter.status !== "active" ||
        !canWriteCustomTemplate(fresh, undefined, visibility)
      )
        throw new Error("项目归属或模板权限已变化，未发送导入。");
      const fingerprint = JSON.stringify([
        scope.tenant_id,
        scope.membership_id,
        preview.sha256,
        name.trim(),
        visibility,
      ]);
      const key = attempts.current.get(fingerprint) ?? crypto.randomUUID();
      attempts.current.set(fingerprint, key);
      const receipt = await saveCustomTemplate({
        tenantId: scope.tenant_id,
        name,
        content: preview.content,
        visibility,
        idempotencyKey: key,
        signal: controller.signal,
      });
      assertCurrent();
      if (receipt.current_version_number !== 1)
        throw new Error("导入回执不是新模板第一版，请核验目录；未重复导入。");
      const stored = await readCustomTemplateVersion(
        scope.tenant_id,
        receipt.template_id,
        1,
        controller.signal,
      );
      assertCurrent();
      if (
        stored.content !== preview.content ||
        stored.version.content_sha256 !== preview.sha256
      )
        throw new Error("保存回读与原件不一致，请核验目录；未自动重新导入。");
      setSaved(true);
      void client.invalidateQueries({
        queryKey: ["law", "custom-templates", scope.tenant_id],
      });
    } catch (cause) {
      if (mounted.current && !controller.signal.aborted)
        setError(
          cause instanceof Error
            ? cause.message
            : "导入结果未确认，请重试同一请求。",
        );
    } finally {
      if (active.current === controller) active.current = null;
      if (mounted.current && !controller.signal.aborted) setPending(false);
    }
  }
  return (
    <DialogContent className="flex max-h-[85dvh] flex-col overflow-hidden sm:max-w-lg">
      <DialogHeader className="shrink-0">
        <DialogTitle>导入旧模板</DialogTitle>
        <DialogDescription>
          当前项目：{project.data?.title ?? "正在核验"}
          。先在本地检查原件，再确认保存到当前租户的模板库。不启动
          Agent，不改写原文件。
        </DialogDescription>
      </DialogHeader>
      <div className="shrink-0">{sourceSelector}</div>
      <div className="min-h-0 space-y-4 overflow-y-auto px-1">
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
        {saved ? (
          <p role="status">
            已导入为新模板第 1 版，回读字节和 SHA-256
            与原件一致。可切到“自定义模板”选择打开，再在右侧原生编辑器编辑；没有创建项目成果或安装
            Skill。
          </p>
        ) : (
          <>
            <div className="space-y-2">
              <label htmlFor="law-template-import-file">
                旧模板文件（UTF-8，最多 64 KiB）
              </label>
              <Input
                id="law-template-import-file"
                type="file"
                accept=".md,.markdown"
                disabled={pending}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = "";
                  void selectFile(file);
                }}
              />
            </div>
            {preview && (
              <>
                <div className="text-muted-foreground space-y-1 text-sm break-all">
                  <p>
                    原文件：{preview.filename} · {preview.byteSize} 字节 ·{" "}
                    {preview.bom ? "保留 UTF-8 BOM" : "无 BOM"}
                  </p>
                  <p>SHA-256：{preview.sha256}</p>
                  <p>
                    完整原文字节作为第一版保存；不转换换行或替换变量，原件仍在本地。
                  </p>
                </div>
                <details className="rounded-md border p-3">
                  <summary className="cursor-pointer">
                    查看原文（仅文本，不执行链接或指令）
                  </summary>
                  <pre className="mt-2 max-h-48 overflow-y-auto text-xs break-all whitespace-pre-wrap">
                    {preview.content || "（空白模板）"}
                  </pre>
                </details>
                <div className="space-y-2 text-sm">
                  <p>变量兼容性（仅诊断，不修改）：</p>
                  <ul className="space-y-1 break-all">
                    {preview.diagnostics.map((entry, index) => (
                      <li key={index}>
                        <code>{entry.placeholder}</code> × {entry.count}：
                        {entry.kind === "preserved"
                          ? "未识别，原样保留"
                          : entry.kind === "date-format"
                            ? "日期/时间格式；YYYY MM DD HH mm ss 替换，其余文字保留，缺分量待填写"
                            : "支持；值内花括号不递归替换"}
                      </li>
                    ))}
                  </ul>
                  {!preview.diagnostics.length && (
                    <p>未发现完整双花括号占位符；其他文字仍原样保留。</p>
                  )}
                  {preview.omittedDiagnostics > 0 && (
                    <p>
                      另有 {preview.omittedDiagnostics}{" "}
                      种占位符未展开显示，原文全部保留。
                    </p>
                  )}
                </div>
                <div className="space-y-2">
                  <label htmlFor="law-template-import-name">新模板名称</label>
                  <Input
                    id="law-template-import-name"
                    value={name}
                    disabled={pending}
                    aria-required="true"
                    onChange={(event) => {
                      setName(event.target.value);
                      setConfirmed(false);
                    }}
                  />
                  <label htmlFor="law-template-import-visibility">
                    保存范围
                  </label>
                  <select
                    id="law-template-import-visibility"
                    value={visibility}
                    disabled={pending}
                    className="border-input bg-background focus-visible:ring-ring w-full rounded-md border p-2 focus-visible:ring-2"
                    onChange={(event) => {
                      setVisibility(event.target.value as "private" | "shared");
                      setConfirmed(false);
                    }}
                  >
                    <option value="private">个人模板（仅本人）</option>
                    <option
                      value="shared"
                      disabled={
                        !scope ||
                        !["owner", "admin"].includes(scope.tenant_role)
                      }
                    >
                      组织模板（全租户成员可见）
                    </option>
                  </select>
                </div>
                <p className="text-sm">
                  模板可能包含旧案件事实或个人信息，请逐项核对；诊断不是隐私或法律质量审核。组织模板会对当前租户成员公开，不会覆盖同名模板。
                </p>
                <label className="flex cursor-pointer items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={confirmed}
                    disabled={pending}
                    onChange={(event) => setConfirmed(event.target.checked)}
                  />
                  我已核对原文、模板名称和保存范围，确认导入
                </label>
              </>
            )}
          </>
        )}
        <p className="text-muted-foreground text-xs">
          服务端再次鉴权、扫描正文并记录不可变版本。保存结果未确认时，在此窗口重试同一请求；关闭或切换不会保证撤销已发送的保存，也不会保留跨窗口重试标识。
        </p>
      </div>
      <DialogFooter className="shrink-0">
        <Button variant="outline" className="cursor-pointer" onClick={onClose}>
          关闭
        </Button>
        {!saved && (
          <Button
            className="cursor-pointer"
            disabled={
              pending ||
              Boolean(blocked) ||
              !preview ||
              !name.trim() ||
              !confirmed
            }
            onClick={() => void save()}
          >
            {pending ? "正在核验…" : "确认导入新模板"}
          </Button>
        )}
      </DialogFooter>
    </DialogContent>
  );
}
