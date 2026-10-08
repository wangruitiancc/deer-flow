"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useRef } from "react";
import { toast } from "sonner";

import { usePromptInputController } from "@/components/ai-elements/prompt-input";
import { useArtifacts } from "@/components/workspace/artifacts/context";
import { useThread } from "@/components/workspace/messages/context";
import {
  getMatterContextByThread,
  useLawMatter,
  useLawThreadContext,
} from "@/core/law";
import {
  LEGACY_GRAPH_HANDOFF_PROMPT,
  serializeLegacyGraphPreview,
  type LegacyGraphPreviewData,
} from "@/core/law/legal-graph-import";
import { getUploadLimits, validateUploadLimits } from "@/core/uploads";

import { LegacyGraphImportPreview } from "./legacy-graph-import-preview";

export function LegalGraphImportHandoff({ threadId }: { threadId: string }) {
  const composer = usePromptInputController();
  const { thread, isMock } = useThread();
  const { setOpen } = useArtifacts();
  const context = useLawThreadContext(threadId);
  const scope = context.data;
  const project = useLawMatter(
    scope?.tenant_id ?? null,
    scope?.matter_id ?? null,
  );
  const queryClient = useQueryClient();
  const latest = useRef({ composer, threadId, scope, busy: thread.isLoading });
  latest.current = { composer, threadId, scope, busy: thread.isLoading };
  const blocked =
    isMock ||
    context.isError ||
    project.isError ||
    !scope ||
    project.data?.status !== "active"
      ? "正在核验当前项目，或项目已不可用。"
      : thread.isLoading
        ? "请先等待当前运行结束。"
        : !["owner", "lead", "lawyer"].includes(scope.matter_role)
          ? "当前成员无图谱处理权限。"
          : undefined;

  async function stage(preview: LegacyGraphPreviewData, signal: AbortSignal) {
    if (blocked || !scope) throw new Error(blocked ?? "当前项目不可用。");
    const assertEmpty = () => {
      signal.throwIfAborted();
      const current = latest.current;
      if (
        current.threadId !== threadId ||
        current.scope?.tenant_id !== scope.tenant_id ||
        current.scope.matter_id !== scope.matter_id ||
        current.busy
      )
        throw new Error("会话或项目状态已变化，请重新打开转换预览。");
      if (
        current.composer.textInput.value.length ||
        current.composer.attachments.files.length
      )
        throw new Error(
          "输入框已有草稿或附件，未覆盖。请先处理现有内容，再放入图谱。",
        );
      return current.composer;
    };
    assertEmpty();
    const [fresh, limits] = await Promise.all([
      getMatterContextByThread(threadId, signal),
      getUploadLimits(threadId),
    ]);
    if (
      fresh.thread_id !== threadId ||
      fresh.tenant_id !== scope.tenant_id ||
      fresh.matter_id !== scope.matter_id ||
      !["owner", "lead", "lawyer"].includes(fresh.matter_role)
    )
      throw new Error("当前项目归属或权限已变化，未添加附件。");
    const serialized = serializeLegacyGraphPreview(preview);
    const suffix = crypto.randomUUID();
    const files = [
      new File([serialized.graph], `转换图谱-${suffix}.law-graph.json`, {
        type: "application/json",
      }),
      new File([serialized.report], `迁移报告-${suffix}.import-report.json`, {
        type: "application/json",
      }),
    ];
    if (validateUploadLimits([], files, limits).rejected.length)
      throw new Error(
        "图谱与报告超过当前附件限制，未添加任何文件；可分别下载后处理。",
      );
    const target = assertEmpty();
    queryClient.setQueryData(["uploads", "limits", threadId], limits);
    target.attachments.add(files);
    target.textInput.setInput(LEGACY_GRAPH_HANDOFF_PROMPT);
    setOpen(false);
    toast.success("已放入当前会话草稿；尚未上传或运行，请检查后点击发送。", {
      closeButton: true,
    });
  }
  return (
    <LegacyGraphImportPreview
      onStage={stage}
      stageBlockedReason={blocked}
      targetLabel={project.data?.title}
    />
  );
}
