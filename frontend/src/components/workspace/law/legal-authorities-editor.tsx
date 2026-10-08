"use client";

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  type LegalAuthorities,
  type LegalAuthorityEntry,
} from "@/core/law/legal-authorities";
import {
  authorityValues,
  editLegalAuthorities,
  type AuthorityEdit,
  type AuthorityValues,
} from "@/core/law/legal-authorities-editing";

export type AuthorityEditorTarget =
  | { kind: "manual" }
  | { kind: "collect" }
  | { kind: "document" }
  | { kind: "entry" | "remove" | "restore"; id: string };
const names = {
  manual: "手工添加法律依据",
  collect: "从已有来源收录",
  document: "编辑研究问题",
  entry: "编辑法律依据",
  remove: "移除法律依据",
  restore: "恢复法律依据",
};
const dateFields = [
  ["published_date", "公布日期"],
  ["effective_date", "施行日期"],
  ["repealed_date", "废止日期"],
  ["relevant_date", "事实时点"],
] as const;
const selectClass =
  "bg-background min-h-9 w-full min-w-0 rounded-md border px-2";

export function LegalAuthoritiesEditor({
  document,
  target,
  onChange,
  onClose,
}: {
  document: LegalAuthorities;
  target: AuthorityEditorTarget;
  onChange?: (document: LegalAuthorities) => void;
  onClose: () => void;
}) {
  const [baseline] = useState(document);
  const [baselineTarget] = useState(target);
  const [entry] = useState(() =>
    "id" in target
      ? document.entries.find((item) => item.id === target.id)
      : undefined,
  );
  const [initialValues] = useState<AuthorityValues>(() =>
    entry
      ? authorityValues(entry)
      : { law_name: "", text: "", text_kind: "summary" },
  );
  const [value, setValue] = useState(initialValues);
  const [title, setTitle] = useState(document.title);
  const [question, setQuestion] = useState(document.question);
  const [sourceId, setSourceId] = useState("");
  const [reference, setReference] = useState("");
  const [reason, setReason] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const latest = useRef({ document, onChange, target });
  const active = useRef(true);
  useLayoutEffect(() => {
    latest.current = { document, onChange, target };
  }, [document, onChange, target]);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  const stale = document !== baseline || target !== baselineTarget;
  const disabled = !onChange || stale || pending;
  const editingValues =
    target.kind === "entry" ||
    target.kind === "manual" ||
    target.kind === "collect";
  const dirty =
    JSON.stringify(value) !== JSON.stringify(initialValues) ||
    title !== baseline.title ||
    question !== baseline.question ||
    Boolean(sourceId || reference || reason);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  const source = baseline.sources.find((item) => item.id === sourceId);
  const subject = entry
    ? `${entry.law_name} ${entry.article_label ?? ""}`
    : title;
  function close() {
    if (!dirty || window.confirm("放弃尚未应用的法律依据表单修改？")) {
      active.current = false;
      onClose();
    }
  }
  function patch(next: Partial<AuthorityValues>) {
    setValue((current) => ({ ...current, ...next }));
    setConfirmed(false);
  }
  async function apply() {
    if (disabled || !confirmed) return;
    setPending(true);
    setError("");
    try {
      const values = { ...value };
      if (editingValues)
        for (const [key, label] of dateFields) {
          const date = values[key];
          if (date && !date.value && !date.basis) values[key] = null;
          else if (date && (!date.value.trim() || !date.basis.trim()))
            throw new Error(`${label}须同时填写日期与依据，或同时清空。`);
        }
      let edit: AuthorityEdit;
      if (target.kind === "document")
        edit = { kind: "document", title, question };
      else if (target.kind === "manual")
        edit = {
          kind: "manual",
          id: `authority-${crypto.randomUUID()}`,
          sourceId: `source-${crypto.randomUUID()}`,
          reference: reference || null,
          value: values,
        };
      else if (target.kind === "collect")
        edit = {
          kind: "collect",
          id: `authority-${crypto.randomUUID()}`,
          sourceId,
          value: values,
        };
      else if (target.kind === "entry")
        edit = { kind: "entry", id: target.id, value: values };
      else if (target.kind === "remove")
        edit = { kind: "remove", id: target.id, reason };
      else edit = { kind: "restore", id: target.id };
      const next = await editLegalAuthorities(baseline, edit);
      if (!active.current) return;
      if (
        latest.current.document !== baseline ||
        latest.current.target !== baselineTarget ||
        !latest.current.onChange
      )
        throw new Error("当前文件或编辑状态已变化，请关闭后重新打开。");
      latest.current.onChange(next);
      onClose();
    } catch (cause) {
      if (active.current)
        setError(cause instanceof Error ? cause.message : "无法应用修改。");
    } finally {
      if (active.current) setPending(false);
    }
  }
  const field = (label: string, control: ReactNode) => (
    <label className="grid min-w-0 gap-1 text-sm">
      {label}
      {control}
    </label>
  );
  const input = (
    key: "law_name" | "article_label" | "law_version" | "jurisdiction",
    label: string,
  ) =>
    field(
      label,
      <Input
        value={value[key] ?? ""}
        onChange={(event) =>
          patch({
            [key]: event.target.value || (key === "law_name" ? "" : null),
          })
        }
        required={key === "law_name"}
      />,
    );
  const area = (
    key:
      | "text"
      | "validity_statement"
      | "applicability_analysis"
      | "uncertainty"
      | "inclusion_reason",
    label: string,
  ) =>
    field(
      label,
      <Textarea
        value={value[key] ?? ""}
        rows={key === "text" ? 5 : 3}
        required={key === "text" && value.text_kind !== "reference_only"}
        onChange={(event) =>
          patch({
            [key]:
              event.target.value ||
              (key === "text" && value.text_kind !== "reference_only"
                ? ""
                : null),
          })
        }
      />,
    );
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <DialogContent
        className="flex max-h-[90dvh] min-w-0 flex-col gap-3 overflow-hidden sm:max-w-xl"
        onEscapeKeyDown={(event) => {
          event.preventDefault();
          close();
        }}
      >
        <DialogHeader className="shrink-0 pr-6">
          <DialogTitle>{names[target.kind]}</DialogTitle>
          <DialogDescription>
            只应用到当前原生文件草稿。仍需保存文件，再保存项目版本；收录不是法律核验或批准。
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex min-h-0 min-w-0 flex-col gap-3 overflow-hidden"
          onSubmit={(event) => {
            event.preventDefault();
            void apply();
          }}
        >
          <div className="min-h-0 overflow-y-auto overscroll-contain px-1 pb-1">
            <fieldset
              disabled={disabled}
              className="min-w-0 space-y-3 [overflow-wrap:anywhere]"
            >
              {target.kind === "document" && (
                <>
                  {field(
                    "成果名称",
                    <Input
                      value={title}
                      required
                      onChange={(event) => {
                        setTitle(event.target.value);
                        setConfirmed(false);
                      }}
                    />,
                  )}
                  {field(
                    "研究问题",
                    <Textarea
                      value={question}
                      required
                      rows={6}
                      onChange={(event) => {
                        setQuestion(event.target.value);
                        setConfirmed(false);
                      }}
                    />,
                  )}
                </>
              )}
              {target.kind === "collect" && (
                <>
                  {field(
                    "选择已记录来源",
                    <select
                      className={selectClass}
                      value={sourceId}
                      required
                      onChange={(event) => {
                        setSourceId(event.target.value);
                        setConfirmed(false);
                      }}
                    >
                      <option value="">请选择来源</option>
                      {baseline.sources.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.id} · {item.kind}
                        </option>
                      ))}
                    </select>,
                  )}
                  {source && (
                    <div className="space-y-2 rounded-md border p-2 text-sm">
                      <p>
                        只关联已记录来源，未重新抓取或核验。不同版本不按法律名称静默合并。
                      </p>
                      {source.kind === "legacy_reference" ? (
                        <p>
                          旧收藏只记录引用，未提供可复制的正文。请先核对来源，再手工补充条文或摘要。
                        </p>
                      ) : source.kind !== "project_citation" ? (
                        <>
                          <details>
                            <summary className="cursor-pointer">
                              预览已记录来源文字
                            </summary>
                            <p className="mt-2 max-h-40 overflow-y-auto whitespace-pre-wrap">
                              {source.text}
                            </p>
                          </details>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              if (
                                !value.text ||
                                window.confirm(
                                  "用已记录来源文字替换当前条文输入？",
                                )
                              )
                                patch({
                                  text: source.text,
                                  text_kind:
                                    source.kind === "legacy_excerpt"
                                      ? "legacy_excerpt"
                                      : "quotation",
                                });
                            }}
                          >
                            使用来源文字
                          </Button>
                        </>
                      ) : (
                        <p>
                          项目引文请先在来源详情中读取核对；此处不根据 ID
                          补造原文。
                        </p>
                      )}
                    </div>
                  )}
                </>
              )}
              {editingValues && (
                <>
                  {input("law_name", "法律名称")}
                  {input("article_label", "条号（可留空）")}
                  {input("law_version", "法律版本（未核验，可留空）")}
                  {input("jurisdiction", "地域 / 法域（可留空）")}
                  {field(
                    "正文性质",
                    <select
                      className={selectClass}
                      value={value.text_kind}
                      onChange={(event) =>
                        patch({
                          text_kind: event.target
                            .value as LegalAuthorityEntry["text_kind"],
                        })
                      }
                    >
                      <option value="summary">摘要（非条文原文）</option>
                      <option value="quotation">引用条文（未核验）</option>
                      <option value="legacy_excerpt">历史摘录（未核验）</option>
                      {entry?.legacy_origin && (
                        <option value="reference_only">
                          仅引用（正文缺失）
                        </option>
                      )}
                    </select>,
                  )}
                  {area("text", "条文或摘要内容")}
                  {target.kind === "manual" &&
                    field(
                      "出处说明（可留空）",
                      <Textarea
                        value={reference}
                        onChange={(event) => {
                          setReference(event.target.value);
                          setConfirmed(false);
                        }}
                      />,
                    )}
                  {target.kind === "entry" && (
                    <p className="text-muted-foreground text-xs">
                      原来源、ID、加入方式和旧导入记录保持不变；修改正文不会改写来源原文。
                    </p>
                  )}
                  <details>
                    <summary className="cursor-pointer text-sm font-medium">
                      日期与时点（缺失请留空，不默认今天）
                    </summary>
                    <div className="mt-3 space-y-3">
                      {dateFields.map(([key, label]) => (
                        <div
                          key={key}
                          className="space-y-2 rounded-md border p-2"
                        >
                          {field(
                            `${label}（年 / 年月 / 年月日）`,
                            <Input
                              value={value[key]?.value ?? ""}
                              placeholder="YYYY / YYYY-MM / YYYY-MM-DD"
                              onChange={(event) =>
                                patch({
                                  [key]: {
                                    value: event.target.value,
                                    basis:
                                      event.target.value === value[key]?.value
                                        ? (value[key]?.basis ?? "")
                                        : "",
                                  },
                                })
                              }
                            />,
                          )}
                          {field(
                            `${label}的依据`,
                            <Textarea
                              rows={2}
                              value={value[key]?.basis ?? ""}
                              onChange={(event) =>
                                patch({
                                  [key]: {
                                    value: value[key]?.value ?? "",
                                    basis: event.target.value,
                                  },
                                })
                              }
                            />,
                          )}
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            onClick={() => patch({ [key]: null })}
                          >
                            清空{label}
                          </Button>
                        </div>
                      ))}
                    </div>
                  </details>
                  {area("inclusion_reason", "收录理由")}
                  {area("applicability_analysis", "适用性分析（非条文原文）")}
                  {area("validity_statement", "效力说明（未核验）")}
                  {area("uncertainty", "不确定性 / 待核实问题")}
                </>
              )}
              {target.kind === "remove" && (
                <>
                  <p className="text-sm">
                    保留条文、来源及条目标识，只标记移除；此前项目版本不会被删除。
                  </p>
                  {field(
                    "移除原因",
                    <Textarea
                      value={reason}
                      required
                      rows={4}
                      onChange={(event) => {
                        setReason(event.target.value);
                        setConfirmed(false);
                      }}
                    />,
                  )}
                </>
              )}
              {target.kind === "restore" && (
                <>
                  <p className="whitespace-pre-wrap">
                    当前移除原因：{entry?.removal_reason}
                  </p>
                  <p className="text-sm">
                    恢复为已收录，当前草稿的移除原因将清空。若需保留这次移除记录，请先取消并保存移除版本；历史中仅保留已经保存的版本。
                  </p>
                </>
              )}
            </fieldset>
          </div>
          <div className="shrink-0 space-y-2 border-t pt-3">
            <p
              className="text-muted-foreground line-clamp-2 text-xs [overflow-wrap:anywhere]"
              title={subject}
            >
              目标：{subject}
            </p>
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                checked={confirmed}
                disabled={disabled}
                onChange={(event) => setConfirmed(event.target.checked)}
                className="mt-1"
              />
              确认应用到当前文件草稿（未审核）
            </label>
            {stale && (
              <p role="alert" className="text-destructive text-sm">
                文件已变化，请关闭后重新打开，不会覆盖其他修改。
              </p>
            )}
            {!onChange && (
              <p role="status" className="text-muted-foreground text-sm">
                原生文件已不可编辑，请关闭并核对运行、冲突或编辑状态。
              </p>
            )}
            {error && (
              <p role="alert" className="text-destructive text-sm">
                {error}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={close}>
                取消
              </Button>
              <Button type="submit" disabled={disabled || !confirmed}>
                {pending ? "正在检查草稿…" : "应用到草稿"}
              </Button>
            </div>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
