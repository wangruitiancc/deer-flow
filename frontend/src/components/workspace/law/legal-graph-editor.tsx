"use client";

import { useEffect, useId, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  legalGraphCategories,
  legalGraphConfidenceLabels,
  legalGraphNodeTypes,
  type LegalGraph,
  type LegalGraphEdge,
  type LegalGraphNode,
} from "@/core/law/legal-graph";
import {
  editedEventDate,
  editLegalGraph,
  legalGraphCategoryLabels,
  legalGraphNodeTypeLabels,
  type LegalGraphEdit,
} from "@/core/law/legal-graph-editing";

export type GraphEditorTarget =
  | { kind: "title" }
  | { kind: "node"; value: LegalGraphNode; create?: boolean }
  | { kind: "edge"; value: LegalGraphEdge; create?: boolean };

export function LegalGraphEditor({
  graph,
  target,
  onChange,
  onClose,
}: {
  graph: LegalGraph;
  target: GraphEditorTarget;
  onChange?: (graph: LegalGraph) => void;
  onClose: () => void;
}) {
  const [baseline] = useState(graph);
  const [title, setTitle] = useState(graph.title);
  const [node, setNode] = useState<LegalGraphNode | null>(
    target.kind === "node" ? target.value : null,
  );
  const [edge, setEdge] = useState<LegalGraphEdge | null>(
    target.kind === "edge" ? target.value : null,
  );
  const [date, setDate] = useState(node?.date?.value ?? "");
  const [x, setX] = useState(node?.position?.x.toString() ?? "");
  const [y, setY] = useState(node?.position?.y.toString() ?? "");
  const [error, setError] = useState("");
  const prefix = useId();
  const stale = graph !== baseline;
  const disabled = !onChange || stale;
  const dirty =
    title !== baseline.title ||
    (target.kind === "node" &&
      (JSON.stringify(node) !== JSON.stringify(target.value) ||
        date !== (target.value.date?.value ?? "") ||
        x !== (target.value.position?.x.toString() ?? "") ||
        y !== (target.value.position?.y.toString() ?? ""))) ||
    (target.kind === "edge" &&
      JSON.stringify(edge) !== JSON.stringify(target.value));
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  function close() {
    if (!dirty || window.confirm("放弃尚未应用的图谱表单修改？")) onClose();
  }
  function apply() {
    if (disabled) return;
    try {
      let edit: LegalGraphEdit;
      if (node && target.kind === "node") {
        if (node.type !== "event" && Boolean(x.trim()) !== Boolean(y.trim()))
          throw new Error("固定位置须同时填写 X 和 Y，或同时清空。");
        edit = {
          kind: "node",
          create: target.create,
          value: {
            ...node,
            date:
              node.type === "event"
                ? editedEventDate(target.value, date.trim())
                : null,
            position:
              node.type === "event"
                ? null
                : x.trim() && y.trim()
                  ? { x: Number(x), y: Number(y) }
                  : null,
          },
        };
      } else if (edge && target.kind === "edge")
        edit = { kind: "edge", value: edge, create: target.create };
      else edit = { kind: "title", title };
      onChange?.(editLegalGraph(graph, edit));
      onClose();
    } catch (error) {
      setError(error instanceof Error ? error.message : "无法应用修改。");
    }
  }
  const item = node ?? edge;
  const selectClass =
    "bg-background w-full min-w-0 rounded-md border p-2 text-sm";
  const field = (label: string, child: React.ReactNode) => (
    <label className="grid min-w-0 gap-1 text-sm">
      {label}
      {child}
    </label>
  );
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <DialogContent
        className="max-h-[85dvh] overflow-y-auto sm:max-w-lg"
        onEscapeKeyDown={(event) => {
          event.preventDefault();
          close();
        }}
      >
        <DialogHeader>
          <DialogTitle>
            {target.kind === "title"
              ? "修改图谱名称"
              : `${target.create ? "新增" : "编辑"}${node ? "节点" : "关系"}`}
          </DialogTitle>
          <DialogDescription>
            应用到当前文件草稿后，仍须点击文件工具栏的保存；保存到项目会创建未审核版本，不是事实认定。
          </DialogDescription>
        </DialogHeader>
        <form
          className="min-w-0 space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            apply();
          }}
        >
          <fieldset disabled={disabled} className="min-w-0 space-y-3">
            {target.kind === "title" &&
              field(
                "图谱名称",
                <Input
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                />,
              )}
            {node && (
              <>
                {field(
                  "节点名称",
                  <Input
                    value={node.label}
                    onChange={(event) =>
                      setNode({ ...node, label: event.target.value })
                    }
                  />,
                )}
                <div className="grid grid-cols-2 gap-3">
                  {field(
                    "节点类型",
                    <select
                      className={selectClass}
                      value={node.type}
                      onChange={(event) =>
                        setNode({
                          ...node,
                          type: event.target.value as LegalGraphNode["type"],
                        })
                      }
                    >
                      {legalGraphNodeTypes.map((key) => (
                        <option key={key} value={key}>
                          {legalGraphNodeTypeLabels[key]}
                        </option>
                      ))}
                    </select>,
                  )}
                  {field(
                    "节点图层",
                    <select
                      className={selectClass}
                      value={node.category}
                      onChange={(event) =>
                        setNode({
                          ...node,
                          category: event.target
                            .value as LegalGraphNode["category"],
                        })
                      }
                    >
                      {legalGraphCategories.map((key) => (
                        <option key={key} value={key}>
                          {legalGraphCategoryLabels[key]}
                        </option>
                      ))}
                    </select>,
                  )}
                </div>
                {node.type === "event" ? (
                  <>
                    {field(
                      "事件日期（可留空）",
                      <Input
                        aria-describedby={`${prefix}-date`}
                        placeholder="YYYY、YYYY-MM 或 YYYY-MM-DD"
                        value={date}
                        onChange={(event) => setDate(event.target.value)}
                      />,
                    )}
                    <p
                      id={`${prefix}-date`}
                      className="text-muted-foreground text-xs"
                    >
                      保留材料的日期精度；修改日期标为用户提供。事件位置由固定时间线决定。
                    </p>
                  </>
                ) : (
                  <div className="space-y-2">
                    <div className="grid grid-cols-2 gap-3">
                      {field(
                        "固定位置 X",
                        <Input
                          type="number"
                          step="any"
                          min={-100000}
                          max={100000}
                          value={x}
                          onChange={(event) => setX(event.target.value)}
                        />,
                      )}
                      {field(
                        "固定位置 Y",
                        <Input
                          type="number"
                          step="any"
                          min={-100000}
                          max={100000}
                          value={y}
                          onChange={(event) => setY(event.target.value)}
                        />,
                      )}
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setX("");
                        setY("");
                      }}
                    >
                      恢复自动位置
                    </Button>
                  </div>
                )}
              </>
            )}
            {edge && (
              <>
                {field(
                  "关系名称",
                  <Input
                    value={edge.label}
                    onChange={(event) =>
                      setEdge({ ...edge, label: event.target.value })
                    }
                  />,
                )}
                {(["source", "target"] as const).map((key) => (
                  <div key={key}>
                    {field(
                      key === "source" ? "起点节点" : "终点节点",
                      <select
                        className={selectClass}
                        value={edge[key]}
                        onChange={(event) =>
                          setEdge({ ...edge, [key]: event.target.value })
                        }
                      >
                        {graph.nodes.map((node) => (
                          <option key={node.id} value={node.id}>
                            {node.label} ({node.id})
                          </option>
                        ))}
                      </select>,
                    )}
                  </div>
                ))}
                {field(
                  "关系图层",
                  <select
                    className={selectClass}
                    value={edge.category}
                    onChange={(event) =>
                      setEdge({
                        ...edge,
                        category: event.target
                          .value as LegalGraphEdge["category"],
                      })
                    }
                  >
                    {legalGraphCategories.map((key) => (
                      <option key={key} value={key}>
                        {legalGraphCategoryLabels[key]}
                      </option>
                    ))}
                  </select>,
                )}
                {field(
                  "认知状态（不是审核）",
                  <select
                    className={selectClass}
                    value={edge.confidence}
                    onChange={(event) =>
                      setEdge({
                        ...edge,
                        confidence: event.target
                          .value as LegalGraphEdge["confidence"],
                      })
                    }
                  >
                    {Object.entries(legalGraphConfidenceLabels).map(
                      ([key, value]) => (
                        <option key={key} value={key}>
                          {value}
                        </option>
                      ),
                    )}
                  </select>,
                )}
                {field(
                  "挖掘角度",
                  <select
                    className={selectClass}
                    value={edge.angle ?? ""}
                    onChange={(event) =>
                      setEdge({
                        ...edge,
                        angle: (event.target.value ||
                          null) as LegalGraphEdge["angle"],
                      })
                    }
                  >
                    <option value="">未指定</option>
                    {legalGraphCategories.map((key) => (
                      <option key={key} value={key}>
                        {legalGraphCategoryLabels[key]}
                      </option>
                    ))}
                  </select>,
                )}
              </>
            )}
            {item && (
              <fieldset className="min-w-0 space-y-2 rounded-md border p-2">
                <legend className="px-1 text-sm">关联来源（最多 32 个）</legend>
                <p className="text-muted-foreground text-xs">
                  仅关联当前图谱已有来源；引用存在不代表能证明此节点或关系。
                </p>
                <div className="max-h-36 space-y-2 overflow-y-auto">
                  {graph.sources.map((source) => (
                    <label
                      key={source.id}
                      className="flex items-start gap-2 text-sm break-all"
                    >
                      <input
                        type="checkbox"
                        className="mt-1"
                        checked={item.source_ids.includes(source.id)}
                        disabled={
                          !item.source_ids.includes(source.id) &&
                          item.source_ids.length >= 32
                        }
                        onChange={(event) => {
                          const source_ids = event.target.checked
                            ? [...item.source_ids, source.id]
                            : item.source_ids.filter((id) => id !== source.id);
                          if (node) setNode({ ...node, source_ids });
                          else if (edge) setEdge({ ...edge, source_ids });
                        }}
                      />
                      {source.id} ·{" "}
                      {source.kind === "citation"
                        ? "受保护引用（查看时核验权限）"
                        : source.kind === "legacy_unmapped"
                          ? "旧来源待映射"
                          : "自报摘录（未核验）"}
                    </label>
                  ))}
                  {!graph.sources.length && (
                    <p className="text-xs">暂无来源，不会自动编造依据。</p>
                  )}
                </div>
              </fieldset>
            )}
          </fieldset>
          {stale && (
            <p role="alert" className="text-destructive text-sm">
              图谱已变化，请取消后重新编辑，未覆盖新内容。
            </p>
          )}
          {!onChange && (
            <p role="alert" className="text-sm">
              当前不可编辑；可能正在运行、保存或存在版本冲突。
            </p>
          )}
          {error && (
            <p role="alert" className="text-destructive text-sm">
              {error}
            </p>
          )}
          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" variant="outline" onClick={close}>
              取消
            </Button>
            <Button type="submit" disabled={disabled}>
              应用到草稿
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
