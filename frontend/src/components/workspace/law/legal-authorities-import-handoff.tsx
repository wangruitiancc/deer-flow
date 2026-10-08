"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useRef } from "react";
import { toast } from "sonner";

import { usePromptInputController } from "@/components/ai-elements/prompt-input";
import { useArtifacts } from "@/components/workspace/artifacts/context";
import { useThread } from "@/components/workspace/messages/context";
import {
  getMatter,
  getMatterContextByThread,
  useLawMatter,
  useLawThreadContext,
} from "@/core/law";
import { LEGACY_AUTHORITIES_HANDOFF_PROMPT } from "@/core/law/legal-authorities-import";
import { getUploadLimits, validateUploadLimits } from "@/core/uploads";

import {
  LegacyAuthoritiesImportPreview,
  type LegacyAuthoritiesPreview,
} from "./legacy-authorities-import-preview";

export function LegalAuthoritiesImportHandoff({
  threadId,
}: {
  threadId: string;
}) {
  const composer = usePromptInputController();
  const { thread, isMock } = useThread();
  const { setOpen } = useArtifacts();
  const context = useLawThreadContext(threadId);
  const scope = context.data;
  const project = useLawMatter(
    scope?.tenant_id ?? null,
    scope?.matter_id ?? null,
  );
  const client = useQueryClient();
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
          ? "当前成员没有法律依据处理权限。"
          : undefined;
  // Selecting a file is scoped to this exact identity/mapping. Changes unmount and abort the preview.
  const scopeKey = JSON.stringify([
    threadId,
    scope?.user_id,
    scope?.tenant_id,
    scope?.membership_id,
    scope?.matter_id,
    scope?.mapping_id,
    scope?.matter_member_id,
    scope?.matter_role,
    scope?.context_version,
    scope?.policy_version,
    project.data?.status,
    context.isError,
    project.isError,
  ]);
  const latest = useRef({ composer, scopeKey, blocked });
  latest.current = { composer, scopeKey, blocked };

  async function stage(preview: LegacyAuthoritiesPreview, signal: AbortSignal) {
    if (blocked || !scope) throw new Error(blocked ?? "当前项目不可用。");
    const assertCurrent = () => {
      signal.throwIfAborted();
      const current = latest.current;
      if (current.scopeKey !== scopeKey || current.blocked)
        throw new Error("会话或项目状态已变化，请重新打开导入预览。");
      if (
        current.composer.textInput.value.length ||
        current.composer.attachments.files.length
      )
        throw new Error("输入框已有草稿或附件，未覆盖。请先处理现有内容。");
      return current.composer;
    };
    assertCurrent();
    const [fresh, freshProject, limits] = await Promise.all([
      getMatterContextByThread(threadId, signal),
      getMatter(scope.tenant_id, scope.matter_id, signal),
      getUploadLimits(threadId),
    ]);
    if (
      fresh.thread_id !== threadId ||
      fresh.user_id !== scope.user_id ||
      fresh.tenant_id !== scope.tenant_id ||
      fresh.matter_id !== scope.matter_id ||
      fresh.membership_id !== scope.membership_id ||
      fresh.matter_member_id !== scope.matter_member_id ||
      fresh.mapping_id !== scope.mapping_id ||
      fresh.context_version !== scope.context_version ||
      fresh.policy_version !== scope.policy_version ||
      !["owner", "lead", "lawyer"].includes(fresh.matter_role) ||
      freshProject.id !== scope.matter_id ||
      freshProject.tenant_id !== scope.tenant_id ||
      freshProject.status !== "active"
    )
      throw new Error("项目归属或权限已变化，未添加附件。请刷新并重新核对。");
    const suffix = crypto.randomUUID();
    const files = [
      new File([preview.content], `转换依据-${suffix}.law-authorities.json`, {
        type: "application/json",
      }),
      new File(
        [JSON.stringify(preview.report, null, 2)],
        `法条迁移报告-${suffix}.import-report.json`,
        { type: "application/json" },
      ),
    ];
    if (validateUploadLimits([], files, limits).rejected.length)
      throw new Error(
        "转换依据与完整报告超过当前附件限制，未添加任何文件；可下载后处理。",
      );
    const target = assertCurrent();
    client.setQueryData(["uploads", "limits", threadId], limits);
    target.attachments.add(files);
    target.textInput.setInput(LEGACY_AUTHORITIES_HANDOFF_PROMPT);
    setOpen(false);
    toast.success("已放入会话草稿；尚未上传或运行，请检查后点击发送。", {
      closeButton: true,
    });
  }
  return (
    <LegacyAuthoritiesImportPreview
      key={scopeKey}
      onStage={stage}
      blocked={blocked}
      targetLabel={project.data?.title}
    />
  );
}
