"use client";

import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { usePromptInputController } from "@/components/ai-elements/prompt-input";
import { Button } from "@/components/ui/button";
import {
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useArtifacts } from "@/components/workspace/artifacts/context";
import { useThread } from "@/components/workspace/messages/context";
import {
  getMatter,
  getMatterContextByThread,
  useLawMatter,
  useLawThreadContext,
} from "@/core/law";
import {
  CUSTOM_TEMPLATE_DRAFT_PROMPT,
  EMPTY_TEMPLATE_VARIABLES,
  customTemplateDraftSelectionFile,
  customTemplateVariablesSchema,
  type TemplateVariableErrors,
  type TemplateVariableField,
} from "@/core/law/custom-template-draft";
import {
  CUSTOM_TEMPLATE_OPEN_PROMPT,
  type CustomTemplate,
  customTemplateSelectionFile,
  getCustomTemplate,
  listCustomTemplates,
  listCustomTemplateVersions,
} from "@/core/law/custom-templates";
import { getUploadLimits, validateUploadLimits } from "@/core/uploads";

import { CustomTemplateValues } from "./custom-template-values";

export function CustomTemplatePicker({
  threadId,
  onClose,
  sourceSelector,
  onManage,
}: {
  threadId: string;
  onClose: () => void;
  sourceSelector: ReactNode;
  onManage?: () => void;
}) {
  const composer = usePromptInputController();
  const { thread, isMock } = useThread();
  const { setOpen: setArtifactsOpen } = useArtifacts();
  const context = useLawThreadContext(threadId);
  const scope = context.data;
  const project = useLawMatter(
    scope?.tenant_id ?? null,
    scope?.matter_id ?? null,
  );
  const client = useQueryClient();
  const [selected, setSelected] = useState<CustomTemplate>();
  const [version, setVersion] = useState("");
  const [mode, setMode] = useState<"copy" | "draft">("copy");
  const [variables, setVariables] = useState({ ...EMPTY_TEMPLATE_VARIABLES });
  const [fieldErrors, setFieldErrors] = useState<TemplateVariableErrors>({});
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const abort = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  const latest = useRef({
    composer,
    scope,
    threadId,
    busy: thread.isLoading,
    mode,
    variables,
    selected,
    version,
  });
  latest.current = {
    composer,
    scope,
    threadId,
    busy: thread.isLoading,
    mode,
    variables,
    selected,
    version,
  };
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      abort.current?.abort();
    };
  }, []);
  const catalog = useInfiniteQuery({
    queryKey: ["law", "custom-templates", scope?.tenant_id],
    initialPageParam: 0,
    queryFn: ({ pageParam, signal }) =>
      listCustomTemplates(scope!.tenant_id, pageParam, signal),
    getNextPageParam: (last, pages) =>
      last.length === 100 ? pages.length * 100 : undefined,
    enabled: Boolean(scope) && !context.isError,
    retry: false,
  });
  const versions = useInfiniteQuery({
    queryKey: [
      "law",
      "custom-template-versions",
      scope?.tenant_id,
      selected?.id,
    ],
    initialPageParam: 0,
    queryFn: ({ pageParam, signal }) =>
      listCustomTemplateVersions(
        scope!.tenant_id,
        selected!.id,
        pageParam,
        signal,
      ),
    getNextPageParam: (last, pages) =>
      last.length === 100 ? pages.length * 100 : undefined,
    enabled: Boolean(scope && selected) && !context.isError,
    retry: false,
  });
  const items = [
    ...new Map(
      (catalog.data?.pages.flat() ?? []).map((item) => [item.id, item]),
    ).values(),
  ];
  const history = [
    ...new Map(
      (versions.data?.pages.flat() ?? []).map((item) => [
        item.version_number,
        item,
      ]),
    ).values(),
  ];
  const entry = history.find((item) => item.version_number === Number(version));
  const blocked =
    isMock ||
    context.isError ||
    project.isError ||
    !scope ||
    project.data?.status !== "active"
      ? "当前项目不可用或仍在核验。"
      : thread.isLoading
        ? "请等待当前运行结束。"
        : !["owner", "lead", "lawyer"].includes(scope.matter_role)
          ? "当前成员没有生成文书权限。"
          : selected &&
              items.find((item) => item.id === selected.id)?.version !==
                selected.version
            ? "模板目录已变化，请刷新并重新选择。"
            : undefined;

  async function stage() {
    if (blocked || !scope || !selected || !entry || pending || abort.current)
      return;
    if (mode === "draft") {
      const validation = customTemplateVariablesSchema.safeParse(variables);
      if (!validation.success) {
        setFieldErrors(
          Object.fromEntries(
            validation.error.issues.map((issue) => [
              issue.path[0] as TemplateVariableField,
              issue.message,
            ]),
          ),
        );
        return;
      }
    }
    setFieldErrors({});
    const controller = new AbortController();
    abort.current = controller;
    setPending(true);
    setError("");
    const assertCurrent = () => {
      controller.signal.throwIfAborted();
      const current = latest.current;
      if (
        !mounted.current ||
        current.threadId !== threadId ||
        current.scope?.mapping_id !== scope.mapping_id ||
        current.scope?.tenant_id !== scope.tenant_id ||
        current.scope?.matter_id !== scope.matter_id ||
        current.busy ||
        current.mode !== mode ||
        current.variables !== variables ||
        current.selected !== selected ||
        current.version !== version
      )
        throw new Error("会话或项目已变化，未添加选择文件。");
      if (
        current.composer.textInput.value.length ||
        current.composer.attachments.files.length
      )
        throw new Error("输入框已有草稿或附件，未覆盖。请先处理现有内容。");
      return current.composer;
    };
    try {
      assertCurrent();
      const [fresh, freshProject, template, limits] = await Promise.all([
        getMatterContextByThread(threadId, controller.signal),
        getMatter(scope.tenant_id, scope.matter_id, controller.signal),
        getCustomTemplate(scope.tenant_id, selected.id, controller.signal),
        getUploadLimits(threadId),
      ]);
      if (
        fresh.thread_id !== threadId ||
        fresh.tenant_id !== scope.tenant_id ||
        fresh.matter_id !== scope.matter_id ||
        fresh.mapping_id !== scope.mapping_id ||
        !["owner", "lead", "lawyer"].includes(fresh.matter_role) ||
        freshProject.status !== "active"
      )
        throw new Error("项目归属或权限已变化，未放入草稿。");
      if (
        template.status !== "active" ||
        template.version !== selected.version ||
        template.current_version_number < entry.version_number
      )
        throw new Error("模板已变化，请刷新并重新选择；未改选其他版本。");
      const file =
        mode === "draft"
          ? customTemplateDraftSelectionFile(
              selected.id,
              entry.version_number,
              variables,
            )
          : customTemplateSelectionFile(selected.id, entry.version_number);
      if (validateUploadLimits([], [file], limits).rejected.length)
        throw new Error("模板选择文件超过当前附件限制，未添加。");
      const target = assertCurrent();
      client.setQueryData(["uploads", "limits", threadId], limits);
      target.attachments.add([file]);
      target.textInput.setInput(
        mode === "draft"
          ? CUSTOM_TEMPLATE_DRAFT_PROMPT
          : CUSTOM_TEMPLATE_OPEN_PROMPT,
      );
      onClose();
      setArtifactsOpen(false);
      toast.success("已放入选择文件和会话草稿；尚未上传或运行，请检查后发送。");
    } catch (cause) {
      if (mounted.current && !controller.signal.aborted)
        setError(cause instanceof Error ? cause.message : "未能准备模板选择。");
    } finally {
      if (abort.current === controller) abort.current = null;
      if (mounted.current) setPending(false);
    }
  }

  return (
    <DialogContent className="flex max-h-[85dvh] flex-col overflow-hidden sm:max-w-lg">
      <DialogHeader className="shrink-0">
        <DialogTitle>打开自定义模板</DialogTitle>
        <DialogDescription>
          目标项目：{project.data?.title ?? "正在核验"}
          。选择具体版本和打开方式，发送后在右侧生成可编辑文件。
        </DialogDescription>
      </DialogHeader>
      {sourceSelector}
      <div className="grid min-h-0 gap-3 overflow-y-auto pr-1">
        {blocked && (
          <p role="status" className="text-sm">
            {blocked}
          </p>
        )}
        {catalog.isPending ? (
          <p role="status">正在读取模板目录…</p>
        ) : catalog.isError ? (
          <p role="alert">无法读取模板库，请检查部署或重新读取。</p>
        ) : (
          <>
            <label
              htmlFor="custom-template-choice"
              className="text-sm font-medium"
            >
              自定义模板
            </label>
            <select
              id="custom-template-choice"
              className="border-input bg-background focus-visible:ring-ring w-full rounded-md border p-2 focus-visible:ring-2"
              value={selected?.id ?? ""}
              disabled={pending}
              onChange={(event) => {
                setSelected(
                  items.find((item) => item.id === event.target.value),
                );
                setVersion("");
                setError("");
                setVariables({ ...EMPTY_TEMPLATE_VARIABLES });
                setFieldErrors({});
              }}
            >
              <option value="">请选择模板</option>
              {items
                .filter((item) => item.status === "active")
                .map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name} ·{" "}
                    {item.visibility === "private" ? "个人" : "组织"}
                  </option>
                ))}
            </select>
            {!items.length && (
              <p role="status" className="text-muted-foreground text-sm">
                暂无可用模板。可先在右侧 Markdown 文件中“保存为模板”。
              </p>
            )}
            {catalog.hasNextPage && (
              <Button
                variant="outline"
                disabled={catalog.isFetchingNextPage || pending}
                onClick={() => void catalog.fetchNextPage()}
              >
                加载更多模板
              </Button>
            )}
          </>
        )}
        {selected && (
          <>
            <label
              htmlFor="custom-template-version"
              className="text-sm font-medium"
            >
              正文版本
            </label>
            <select
              id="custom-template-version"
              className="border-input bg-background focus-visible:ring-ring w-full rounded-md border p-2 focus-visible:ring-2"
              value={version}
              disabled={pending || versions.isFetching}
              onChange={(event) => setVersion(event.target.value)}
            >
              <option value="">请选择具体版本</option>
              {history.map((item) => (
                <option key={item.version_number} value={item.version_number}>
                  第 {item.version_number} 版 · {item.byte_size} 字节
                </option>
              ))}
            </select>
            {versions.isFetching && <p role="status">正在读取版本…</p>}
            {versions.isError && (
              <p role="alert">版本目录不可用，请重新读取。</p>
            )}
            {versions.hasNextPage && (
              <Button
                variant="outline"
                disabled={versions.isFetching || pending}
                onClick={() => void versions.fetchNextPage()}
              >
                加载更早版本
              </Button>
            )}
          </>
        )}
        <label htmlFor="custom-template-mode" className="text-sm font-medium">
          打开方式
        </label>
        <select
          id="custom-template-mode"
          value={mode}
          disabled={pending}
          className="border-input bg-background focus-visible:ring-ring w-full rounded-md border p-2 focus-visible:ring-2"
          onChange={(event) => {
            setMode(event.target.value as "copy" | "draft");
            setFieldErrors({});
            setError("");
          }}
        >
          <option value="copy">原样打开（保留变量）</option>
          <option value="draft">填值起草（替换变量）</option>
        </select>
        {mode === "draft" && (
          <CustomTemplateValues
            values={variables}
            errors={fieldErrors}
            disabled={pending}
            onChange={(value) => {
              setVariables(value);
              setFieldErrors({});
              setError("");
            }}
          />
        )}
        <p className="text-muted-foreground text-sm">
          {mode === "draft"
            ? "模板 ID、版本和填写值仅放入临时选择附件，不读取正文；留空的日期/时间传为“待填写”。"
            : "仅将模板 ID 和版本放入临时选择附件，不读取正文、不填充变量。"}
          不修改原模板或自动保存项目版本。发送时才上传附件并启动
          Agent；附件及填写值会进入本次会话，离开会话后未发送附件不恢复。
        </p>
        {error && (
          <p role="alert" className="text-destructive text-sm">
            {error}
          </p>
        )}
      </div>
      <DialogFooter className="shrink-0">
        {onManage && (
          <Button variant="outline" disabled={pending} onClick={onManage}>
            管理模板
          </Button>
        )}
        <Button
          variant="outline"
          disabled={pending}
          onClick={() => {
            setSelected(undefined);
            setVersion("");
            setError("");
            setVariables({ ...EMPTY_TEMPLATE_VARIABLES });
            setFieldErrors({});
            void catalog.refetch();
          }}
        >
          重新读取
        </Button>
        <Button variant="outline" onClick={onClose}>
          取消
        </Button>
        <Button
          disabled={
            Boolean(blocked) ||
            pending ||
            catalog.isFetching ||
            catalog.isError ||
            versions.isFetching ||
            versions.isError ||
            !entry
          }
          onClick={() => void stage()}
        >
          {pending ? "正在核验…" : "放入当前会话草稿"}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
