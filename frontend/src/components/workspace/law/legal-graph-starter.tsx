"use client";

import { Share2Icon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { usePromptInputController } from "@/components/ai-elements/prompt-input";
import { Button } from "@/components/ui/button";
import { useArtifacts } from "@/components/workspace/artifacts/context";
import { useThread } from "@/components/workspace/messages/context";
import {
  getMatter,
  getMatterContextByThread,
  useLawMatter,
  useLawThreadContext,
} from "@/core/law";

export const LEGAL_GRAPH_START_PROMPT =
  "/matrix-law-graph 请结合本案详情与本案案由或罪名建立专业案情图谱。先用 law_get_current_matter_summary 读取当前项目元数据，核对案由／罪名、程序阶段和本轮分析立场；信息不足或存在多种候选时先向我确认。基于本案授权材料、已读取的法律依据与适用版本，形成该案特有的争点和要件框架，再将本案主体、行为、事实、请求／指控、抗辩与证据映射进去。缺乏规范依据的要件框架只列为待核验的分析假设，不预设指控或案由成立。保留支持、反驳、矛盾和未覆盖事项，分别展示多种法律关系；标记材料明示、模型推断、存疑以及材料记载、当事人主张、分析假设，不补造事实或法条。同时由 AI 自动生成 presentation：按本案法律问题组织有说明的主题视图、颜色分组、初始重点和布局，让律师打开即可阅读，无需先手动配置搜索、过滤和着色。每个主题保留相关支持与相反路径，全部数据留在全图。记录 analysis 分析基线、node.role 和 edge.legal；沿用来源引用、人工修改与稳定 ID。先列出材料与引用覆盖情况，使用 law_validate_graph 校验后写入新的 .law-graph.json，回读并在右侧展示；尚未保存为项目版本或人工审核前，不声称已定稿。";

export function LegalGraphStarter({ threadId }: { threadId: string }) {
  const composer = usePromptInputController();
  const { thread, isMock } = useThread();
  const { setOpen } = useArtifacts();
  const context = useLawThreadContext(threadId);
  const scope = context.data;
  const project = useLawMatter(
    scope?.tenant_id ?? null,
    scope?.matter_id ?? null,
  );
  const [pending, setPending] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  const latest = useRef({ composer, scope, threadId, busy: thread.isLoading });
  latest.current = { composer, scope, threadId, busy: thread.isLoading };

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      abort.current?.abort();
    };
  }, []);

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
          ? "当前成员没有生成案情图谱的权限。"
          : undefined;

  async function stage() {
    if (blocked || !scope || pending || abort.current) return;
    const controller = new AbortController();
    abort.current = controller;
    const assertCurrent = () => {
      controller.signal.throwIfAborted();
      const current = latest.current;
      if (
        !mounted.current ||
        current.threadId !== threadId ||
        current.scope?.mapping_id !== scope.mapping_id ||
        current.scope?.tenant_id !== scope.tenant_id ||
        current.scope?.matter_id !== scope.matter_id ||
        current.busy
      )
        throw new Error("会话或项目已变化，请重新点击生成案情图谱。");
      if (
        current.composer.textInput.value.length ||
        current.composer.attachments.files.length
      )
        throw new Error("输入框已有草稿或附件，未覆盖。请先处理现有内容。");
      return current.composer;
    };

    setPending(true);
    try {
      assertCurrent();
      const [fresh, freshProject] = await Promise.all([
        getMatterContextByThread(threadId, controller.signal),
        getMatter(scope.tenant_id, scope.matter_id, controller.signal),
      ]);
      if (
        fresh.thread_id !== threadId ||
        fresh.mapping_id !== scope.mapping_id ||
        fresh.tenant_id !== scope.tenant_id ||
        fresh.matter_id !== scope.matter_id ||
        !["owner", "lead", "lawyer"].includes(fresh.matter_role) ||
        freshProject.status !== "active"
      )
        throw new Error("项目归属或权限已变化，未放入草稿。");
      assertCurrent().textInput.setInput(LEGAL_GRAPH_START_PROMPT);
      setOpen(false);
      toast.success("已放入当前会话草稿；尚未运行，请检查后点击发送。");
    } catch (cause) {
      if (mounted.current && !controller.signal.aborted)
        toast.error(
          cause instanceof Error ? cause.message : "未能准备案情图谱，请重试。",
        );
    } finally {
      if (abort.current === controller) abort.current = null;
      if (mounted.current) setPending(false);
    }
  }

  return (
    <Button
      size="sm"
      variant="outline"
      className="cursor-pointer"
      disabled={Boolean(blocked) || pending}
      title={blocked}
      onClick={() => void stage()}
    >
      <Share2Icon className="size-4" />
      {pending ? "正在核验…" : "生成案情图谱"}
    </Button>
  );
}
