"use client";

import { useQuery } from "@tanstack/react-query";
import { FilePlus2Icon } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { usePromptInputController } from "@/components/ai-elements/prompt-input";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useArtifacts } from "@/components/workspace/artifacts/context";
import { useThread } from "@/components/workspace/messages/context";
import {
  getMatter,
  getMatterContextByThread,
  useLawMatter,
  useLawThreadContext,
} from "@/core/law";
import {
  buildLegalTemplatePrompt,
  loadLegalTemplateCatalog,
} from "@/core/law/templates";

import { CustomTemplateImport } from "./custom-template-import";
import { CustomTemplateManager } from "./custom-template-manager";
import { CustomTemplatePicker } from "./custom-template-picker";

export function LegalTemplatePicker({ threadId }: { threadId: string }) {
  const [open, setOpen] = useState(false);
  const [source, setSource] = useState<
    "builtin" | "custom" | "import" | "manage"
  >("builtin");
  const sourceSelector = (
    <div role="group" aria-label="模板来源" className="grid grid-cols-3 gap-2">
      <Button
        className="min-w-0 cursor-pointer px-1 text-xs sm:text-sm"
        variant={source === "builtin" ? "secondary" : "outline"}
        aria-pressed={source === "builtin"}
        onClick={() => setSource("builtin")}
      >
        内置模板
      </Button>
      <Button
        className="min-w-0 cursor-pointer px-1 text-xs sm:text-sm"
        variant={
          source === "custom" || source === "manage" ? "secondary" : "outline"
        }
        aria-pressed={source === "custom" || source === "manage"}
        onClick={() => setSource("custom")}
      >
        自定义模板
      </Button>
      <Button
        className="min-w-0 cursor-pointer px-1 text-xs sm:text-sm"
        variant={source === "import" ? "secondary" : "outline"}
        aria-pressed={source === "import"}
        onClick={() => setSource("import")}
      >
        导入旧模板
      </Button>
    </div>
  );
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        setOpen(value);
        if (!value) setSource("builtin");
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" className="cursor-pointer">
          <FilePlus2Icon className="size-4" />
          用模板起草
        </Button>
      </DialogTrigger>
      {open &&
        (source === "manage" ? (
          <CustomTemplateManager
            key={threadId}
            threadId={threadId}
            sourceSelector={sourceSelector}
            onClose={() => setOpen(false)}
          />
        ) : source === "import" ? (
          <CustomTemplateImport
            key={threadId}
            threadId={threadId}
            sourceSelector={sourceSelector}
            onClose={() => setOpen(false)}
          />
        ) : source === "custom" ? (
          <CustomTemplatePicker
            key={threadId}
            threadId={threadId}
            sourceSelector={sourceSelector}
            onClose={() => setOpen(false)}
            onManage={() => setSource("manage")}
          />
        ) : (
          <TemplateForm
            key={threadId}
            threadId={threadId}
            sourceSelector={sourceSelector}
            onClose={() => setOpen(false)}
          />
        ))}
    </Dialog>
  );
}

function TemplateForm({
  threadId,
  onClose,
  sourceSelector,
}: {
  threadId: string;
  onClose: () => void;
  sourceSelector: ReactNode;
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
  const catalog = useQuery({
    queryKey: ["law", "template-catalog", threadId],
    queryFn: ({ signal }) => loadLegalTemplateCatalog(signal),
    retry: false,
    staleTime: 0,
  });
  const [selected, setSelected] = useState("");
  const [title, setTitle] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      abort.current?.abort();
    };
  }, []);
  const latest = useRef({ composer, scope, threadId, busy: thread.isLoading });
  latest.current = { composer, scope, threadId, busy: thread.isLoading };
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
        throw new Error("会话或项目已变化，请重新打开模板选择。");
      if (
        current.composer.textInput.value.length ||
        current.composer.attachments.files.length
      )
        throw new Error("输入框已有草稿或附件，未覆盖。请先处理现有内容。");
      return current.composer;
    };
    setError("");
    setPending(true);
    try {
      assertCurrent();
      const [fresh, freshProject, freshCatalog] = await Promise.all([
        getMatterContextByThread(threadId, controller.signal),
        getMatter(scope.tenant_id, scope.matter_id, controller.signal),
        loadLegalTemplateCatalog(controller.signal),
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
      const entry = freshCatalog.templates.find((item) => item.id === selected);
      if (!entry) throw new Error("所选模板已不可用，请重新选择。");
      const prompt = buildLegalTemplatePrompt(entry, title);
      assertCurrent().textInput.setInput(prompt);
      onClose();
      setArtifactsOpen(false);
      toast.success("已放入当前会话草稿；尚未运行，请检查后点击发送。");
    } catch (cause) {
      if (mounted.current && !controller.signal.aborted)
        setError(
          cause instanceof Error ? cause.message : "未能准备模板，请重试。",
        );
    } finally {
      if (abort.current === controller) abort.current = null;
      if (mounted.current) setPending(false);
    }
  }

  return (
    <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-md">
      <DialogHeader>
        <DialogTitle>用模板起草</DialogTitle>
        <DialogDescription>
          目标项目：{project.data?.title ?? "正在核验"}
          。先准备会话输入，发送后由 Agent 创建草稿并在右侧展示。
        </DialogDescription>
      </DialogHeader>
      {sourceSelector}
      {blocked && (
        <p role="alert" className="text-sm">
          {blocked}
        </p>
      )}
      {catalog.isFetching ? (
        <p role="status">正在读取部署模板…</p>
      ) : catalog.isError ? (
        <div className="space-y-2">
          <p role="alert">无法使用法律模板，请检查当前部署或稍后重试。</p>
          <Button variant="outline" onClick={() => void catalog.refetch()}>
            重新读取
          </Button>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="space-y-2">
            <label htmlFor="law-template-type" className="text-sm font-medium">
              模板类型
            </label>
            <select
              id="law-template-type"
              className="border-input bg-background focus-visible:ring-ring h-10 w-full rounded-md border px-3 text-sm focus-visible:ring-2"
              value={selected}
              disabled={pending}
              onChange={(event) => {
                setSelected(event.target.value);
                setTitle(
                  catalog.data?.templates.find(
                    (item) => item.id === event.target.value,
                  )?.title ?? "",
                );
                setError("");
              }}
            >
              <option value="">请选择模板</option>
              {catalog.data?.templates.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.title}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <label htmlFor="law-template-title" className="text-sm font-medium">
              草稿标题
            </label>
            <Input
              id="law-template-title"
              value={title}
              maxLength={200}
              disabled={pending}
              onChange={(event) => setTitle(event.target.value)}
            />
          </div>
          <p className="text-muted-foreground text-sm">
            创建时间和事实日期默认待填写。不会补造案情，不会自动保存为项目版本。
          </p>
        </div>
      )}
      {error && (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          取消
        </Button>
        <Button
          disabled={
            Boolean(blocked) ||
            pending ||
            catalog.isFetching ||
            catalog.isError ||
            !selected ||
            !title.trim()
          }
          onClick={() => void stage()}
        >
          {pending ? "正在核验…" : "放入当前会话草稿"}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
