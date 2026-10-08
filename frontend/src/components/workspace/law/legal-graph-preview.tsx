"use client";

import dynamic from "next/dynamic";
import { useMemo } from "react";

import { useLawThreadContext } from "@/core/law";
import { parseLegalGraph, type LegalGraph } from "@/core/law/legal-graph";

const Viewer = dynamic(
  () =>
    import("./legal-graph-viewer").then((module) => module.LegalGraphViewer),
  {
    ssr: false,
    loading: () => (
      <p role="status" className="p-4">
        正在加载图谱视图…
      </p>
    ),
  },
);

export function LegalGraphPreview({
  content,
  threadId,
  scope,
  onChange,
}: {
  content: string;
  threadId?: string;
  scope?: { tenant_id: string; matter_id: string };
  onChange?: (graph: LegalGraph) => void;
}) {
  const context = useLawThreadContext(threadId ?? null);
  const parsed = useMemo(() => {
    try {
      return { graph: parseLegalGraph(content) };
    } catch {
      return {
        error:
          "图谱结构无效或超过 2 MiB，无法展示。请检查原始 JSON；不会自动修补或丢弃关系。",
      };
    }
  }, [content]);
  if (!parsed.graph)
    return (
      <p role="alert" className="p-4 text-sm">
        {parsed.error}
      </p>
    );
  const resolvedScope =
    scope ?? (context.isError ? undefined : (context.data ?? undefined));
  return (
    <Viewer
      key={`${threadId ?? "snapshot"}:${resolvedScope?.tenant_id ?? "unresolved"}:${resolvedScope?.matter_id ?? "unresolved"}`}
      graph={parsed.graph}
      scope={resolvedScope}
      onChange={onChange}
    />
  );
}
