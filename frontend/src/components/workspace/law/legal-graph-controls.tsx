"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { type LegalGraph } from "@/core/law/legal-graph";
import {
  compileGraphQuery,
  defaultGraphExplorerOptions,
  type GraphExplorerOptions,
} from "@/core/law/legal-graph-explorer";
import { legalStatementLabels } from "@/core/law/legal-graph-semantics";

export function LegalGraphControls({
  graph,
  options,
  onChange,
}: {
  graph: LegalGraph;
  options: GraphExplorerOptions;
  onChange: (value: GraphExplorerOptions) => void;
}) {
  const [dragged, setDragged] = useState<number | null>(null);
  function patch(value: Partial<GraphExplorerOptions>) {
    onChange({ ...options, ...value });
  }
  function toggle(
    key:
      | "incoming"
      | "outgoing"
      | "interlinks"
      | "showEvidence"
      | "showOrphans"
      | "showUnverified"
      | "arrows",
    label: string,
  ) {
    return (
      <label className="flex cursor-pointer items-center justify-between gap-3 py-1 text-xs">
        <span>{label}</span>
        <input
          aria-label={label}
          type="checkbox"
          checked={options[key]}
          onChange={(event) => patch({ [key]: event.target.checked })}
        />
      </label>
    );
  }
  function range(
    key:
      | "depth"
      | "textFade"
      | "nodeSize"
      | "lineSize"
      | "centerForce"
      | "repelForce"
      | "linkForce"
      | "linkDistance",
    label: string,
    min: number,
    max: number,
    step: number,
  ) {
    return (
      <label className="grid gap-1 py-1 text-xs">
        <span className="flex justify-between gap-2">
          {label}
          <output>{Math.round(options[key] * 100) / 100}</output>
        </span>
        <input
          aria-label={label}
          type="range"
          min={min}
          max={max}
          step={step}
          value={options[key]}
          onChange={(event) => patch({ [key]: Number(event.target.value) })}
          className="w-full cursor-pointer accent-[var(--primary)]"
        />
      </label>
    );
  }
  function reorder(from: number, to: number) {
    if (to < 0 || to >= options.groups.length || from === to) return;
    const groups = [...options.groups];
    const item = groups.splice(from, 1)[0]!;
    groups.splice(to, 0, item);
    patch({ groups });
  }
  const select = "bg-background w-full min-w-0 rounded-md border p-1.5 text-xs";
  return (
    <aside
      aria-label="图谱设置"
      className="bg-background/95 max-h-[65dvh] w-full space-y-3 overflow-y-auto rounded-lg border p-3 shadow-sm"
    >
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">图谱设置</span>
        <Button
          size="sm"
          variant="ghost"
          onClick={() =>
            onChange({
              ...defaultGraphExplorerOptions,
              root: options.root,
              groups: [],
            })
          }
        >
          恢复默认设置
        </Button>
      </div>
      <details open>
        <summary className="cursor-pointer text-xs font-medium">
          筛选与局部范围
        </summary>
        <div className="space-y-2 pt-2">
          <label className="grid gap-1 text-xs">
            局部中心
            <select
              aria-label="局部图谱中心"
              className={select}
              value={options.root ?? ""}
              onChange={(event) => patch({ root: event.target.value || null })}
            >
              <option value="">全图</option>
              {graph.nodes.map((node) => (
                <option key={node.id} value={node.id}>
                  {node.label}
                </option>
              ))}
            </select>
          </label>
          {options.root && (
            <>
              {range("depth", "关系深度", 1, 5, 1)}
              {toggle("incoming", "入向关系")}
              {toggle("outgoing", "出向关系")}
              {toggle("interlinks", "显示邻居之间的关系")}
            </>
          )}
          {toggle("showEvidence", "显示证据材料节点")}
          {toggle("showOrphans", "显示孤立节点")}
          {toggle("showUnverified", "显示未绑定正式引用的内容")}
          <p className="text-muted-foreground text-[11px]">
            有正式引用只说明出处已绑定，不代表证明充分或事实成立。
          </p>
          <label className="grid gap-1 text-xs">
            关系认知状态
            <select
              className={select}
              aria-label="筛选关系认知状态"
              value={options.confidence}
              onChange={(event) => patch({ confidence: event.target.value })}
            >
              <option value="all">全部状态</option>
              <option value="EXTRACTED">材料明示</option>
              <option value="INFERRED">模型推断</option>
              <option value="AMBIGUOUS">存疑</option>
            </select>
          </label>
          <label className="grid gap-1 text-xs">
            陈述性质
            <select
              className={select}
              aria-label="筛选陈述性质"
              value={options.statement}
              onChange={(event) => patch({ statement: event.target.value })}
            >
              <option value="all">全部性质</option>
              {Object.entries(legalStatementLabels).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        </div>
      </details>
      <details>
        <summary className="cursor-pointer text-xs font-medium">
          分组着色
        </summary>
        <div className="space-y-2 pt-2">
          <p className="text-muted-foreground text-[11px]">
            首个匹配组优先；拖动调整顺序，也可使用上移和下移。
          </p>
          {options.groups.map((group, index) => (
            <div
              key={group.id}
              draggable
              onDragStart={() => setDragged(index)}
              onDragEnd={() => setDragged(null)}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                if (dragged !== null) reorder(dragged, index);
                setDragged(null);
              }}
              className="space-y-1 rounded border p-2"
            >
              <div className="flex gap-2">
                <input
                  aria-label={`分组 ${index + 1} 颜色`}
                  type="color"
                  value={group.color}
                  onChange={(event) =>
                    patch({
                      groups: options.groups.map((value) =>
                        value.id === group.id
                          ? { ...value, color: event.target.value }
                          : value,
                      ),
                    })
                  }
                  className="h-8 w-8 shrink-0 cursor-pointer bg-transparent"
                />
                <Input
                  aria-label={`分组 ${index + 1} 查询`}
                  value={group.query}
                  placeholder="type:person 或 role:issue"
                  onChange={(event) =>
                    patch({
                      groups: options.groups.map((value) =>
                        value.id === group.id
                          ? { ...value, query: event.target.value }
                          : value,
                      ),
                    })
                  }
                  className="h-8 min-w-0 text-xs"
                />
              </div>
              {compileGraphQuery(group.query).error && (
                <p role="alert" className="text-destructive text-xs">
                  {compileGraphQuery(group.query).error}
                </p>
              )}
              <div className="flex gap-1">
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={`分组 ${index + 1} 上移`}
                  disabled={!index}
                  onClick={() => reorder(index, index - 1)}
                >
                  上移
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={`分组 ${index + 1} 下移`}
                  disabled={index === options.groups.length - 1}
                  onClick={() => reorder(index, index + 1)}
                >
                  下移
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={`删除分组 ${index + 1}`}
                  onClick={() =>
                    patch({
                      groups: options.groups.filter(
                        (item) => item.id !== group.id,
                      ),
                    })
                  }
                >
                  删除
                </Button>
              </div>
            </div>
          ))}
          <Button
            size="sm"
            variant="outline"
            disabled={options.groups.length >= 16}
            onClick={() =>
              patch({
                groups: [
                  ...options.groups,
                  {
                    id: crypto.randomUUID(),
                    query: "",
                    color: ["#60a5fa", "#fbbf24", "#a78bfa", "#34d399"][
                      options.groups.length % 4
                    ]!,
                  },
                ],
              })
            }
          >
            添加颜色分组
          </Button>
        </div>
      </details>
      <details>
        <summary className="cursor-pointer text-xs font-medium">显示</summary>
        <div className="pt-2">
          {toggle("arrows", "显示关系方向箭头")}
          {range("textFade", "文字淡出阈值", -3, 3, 0.1)}
          {range("nodeSize", "节点尺寸", 0.1, 5, 0.1)}
          {range("lineSize", "关系线宽", 0.1, 5, 0.1)}
        </div>
      </details>
      <details>
        <summary className="cursor-pointer text-xs font-medium">
          布局与力
        </summary>
        <div className="pt-2">
          {range("centerForce", "中心力", 0, 1, 0.01)}
          {range("repelForce", "排斥力", 0, 8000, 50)}
          {range("linkForce", "连线力", 0, 1, 0.01)}
          {range("linkDistance", "连线距离", 30, 500, 1)}
        </div>
      </details>
      <details>
        <summary className="cursor-pointer text-xs font-medium">
          查询说明
        </summary>
        <p className="text-muted-foreground pt-2 text-xs leading-relaxed">
          空格表示同时满足，OR 表示任一满足，-
          排除，双引号匹配词组，括号组合。字段：label、id、type、role、category、family、kind、statement、confidence、source、date。例如
          role:issue OR role:element。视图设置与查询只保留在当前工作区内存中。
        </p>
      </details>
    </aside>
  );
}
