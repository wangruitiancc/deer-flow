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
import { createBlankCustomTemplate } from "@/core/law/custom-template-create";
import { canWriteCustomTemplate } from "@/core/law/custom-templates";

export function CustomTemplateCreate({
  threadId,
  sourceSelector,
  onBack,
  onClose,
}: {
  threadId: string;
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
  const [name, setName] = useState("");
  const [visibility, setVisibility] = useState<"private" | "shared">("private");
  const [confirmed, setConfirmed] = useState(false);
  const [pending, setPending] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const controller = useRef<AbortController | null>(null);
  const attempts = useRef(new Map<string, string>());
  const mounted = useRef(true);
  const formScope = useRef<string | undefined>(undefined);
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
      : thread.isLoading
        ? "请等待当前运行结束。"
        : formScope.current !== undefined && formScope.current !== scopeKey
          ? "项目归属已变化，请返回管理后重新新建。"
          : !canWriteCustomTemplate(scope, undefined, visibility)
            ? "当前成员没有此范围的模板写入权限。"
            : undefined;
  const latest = useRef({ scopeKey, name, visibility, confirmed, blocked });
  latest.current = { scopeKey, name, visibility, confirmed, blocked };
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      controller.current?.abort();
    };
  }, []);
  async function create() {
    if (
      !scope ||
      blocked ||
      !confirmed ||
      !name.trim() ||
      saved ||
      pending ||
      controller.current
    )
      return;
    const current = new AbortController();
    controller.current = current;
    setPending(true);
    setError("");
    let attempted = false;
    function assertCurrent() {
      current.signal.throwIfAborted();
      const now = latest.current;
      if (
        !mounted.current ||
        now.scopeKey !== scopeKey ||
        now.name !== name ||
        now.visibility !== visibility ||
        !now.confirmed ||
        now.blocked
      )
        throw new Error("名称、范围或项目已变化，请重新确认。");
    }
    try {
      const [fresh, matter] = await Promise.all([
        getMatterContextByThread(threadId, current.signal),
        getMatter(scope.tenant_id, scope.matter_id, current.signal),
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
        throw new Error("项目归属或模板权限已变化，未发送新建请求。");
      const fingerprint = JSON.stringify([scopeKey, name.trim(), visibility]);
      const key = attempts.current.get(fingerprint) ?? crypto.randomUUID();
      attempts.current.set(fingerprint, key);
      attempted = true;
      await createBlankCustomTemplate({
        tenantId: scope.tenant_id,
        name,
        visibility,
        idempotencyKey: key,
        signal: current.signal,
      });
      assertCurrent();
      setSaved(true);
      setConfirmed(false);
      void client.invalidateQueries({
        queryKey: ["law", "custom-templates", scope.tenant_id],
      });
    } catch (cause) {
      if (mounted.current && !current.signal.aborted)
        setError(
          `${attempted ? "创建结果未确认；请求可能已提交，可在此窗口用原请求重试核验。" : ""}${cause instanceof Error ? cause.message : "请重试或返回重新读取。"}`,
        );
    } finally {
      if (controller.current === current) controller.current = null;
      if (mounted.current && !current.signal.aborted) setPending(false);
    }
  }
  return (
    <DialogContent className="flex max-h-[85dvh] flex-col overflow-hidden sm:max-w-lg">
      <DialogHeader className="shrink-0">
        <DialogTitle>新建空白模板</DialogTitle>
        <DialogDescription>
          当前项目：{project.data?.title ?? "正在核验"}
          。在当前租户模板库中新建，正文为空，不自动起草或启动 Agent。
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
        {saved ? (
          !blocked && (
            <p role="status">
              已新建模板第 1 版，受保护回读确认正文为 0
              字节。可切到“自定义模板”选择并原样打开，再在右侧原生编辑器编写、保存文件及追加模板版本；尚未创建会话文件或项目成果。
            </p>
          )
        ) : (
          <>
            <label htmlFor="template-create-name">模板名称</label>
            <Input
              id="template-create-name"
              value={name}
              disabled={pending || Boolean(blocked)}
              onChange={(event) => {
                formScope.current ??= scopeKey;
                setName(event.target.value);
                setConfirmed(false);
                setError("");
              }}
            />
            <label htmlFor="template-create-visibility">可见范围</label>
            <select
              id="template-create-visibility"
              className="border-input bg-background w-full rounded-md border p-2"
              value={visibility}
              disabled={pending || Boolean(blocked)}
              onChange={(event) => {
                setVisibility(event.target.value as "private" | "shared");
                setConfirmed(false);
                setError("");
              }}
            >
              <option value="private">个人模板（仅本人可读）</option>
              <option
                value="shared"
                disabled={
                  !scope || !canWriteCustomTemplate(scope, undefined, "shared")
                }
              >
                组织模板（当前租户成员可读，管理员维护）
              </option>
            </select>
            <p className="text-sm">
              新建不包含默认标题、日期或案件事实。同名模板不会被覆盖；后续正文编辑复用右侧文件编辑器。
            </p>
            {visibility === "shared" && (
              <p className="text-sm">
                组织模板的后续正文与历史版本会向有读取权限的成员开放，请勿写入不应共享的客户资料。
              </p>
            )}
            <label className="flex cursor-pointer items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-1"
                checked={confirmed}
                disabled={pending || Boolean(blocked) || !name.trim()}
                onChange={(event) => setConfirmed(event.target.checked)}
              />
              我已核对名称和可见范围，确认创建空白模板
            </label>
          </>
        )}
        <p className="text-muted-foreground text-xs">
          关闭不保证撤销已发送请求；本窗口失败重试使用原请求标识，重新打开不保证去重。不安装
          Skill，不自动保存项目成果。
        </p>
      </div>
      {name && !saved && (
        <p
          aria-label="待新建模板"
          title={name}
          className="shrink-0 truncate text-sm"
        >
          {visibility === "private" ? "个人" : "组织"} · {name} · 空白第一版
        </p>
      )}
      <DialogFooter className="shrink-0">
        <Button variant="outline" onClick={onBack}>
          返回管理
        </Button>
        <Button variant="outline" onClick={onClose}>
          关闭
        </Button>
        {!saved && (
          <Button
            disabled={pending || Boolean(blocked) || !name.trim() || !confirmed}
            onClick={() => void create()}
          >
            {pending ? "正在核验…" : "确认新建"}
          </Button>
        )}
      </DialogFooter>
    </DialogContent>
  );
}
