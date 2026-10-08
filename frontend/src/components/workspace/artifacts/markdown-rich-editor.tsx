import { TableKit } from "@tiptap/extension-table";
import { Markdown } from "@tiptap/markdown";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import {
  BoldIcon,
  Heading1Icon,
  Heading2Icon,
  ItalicIcon,
  ListIcon,
  ListOrderedIcon,
  Redo2Icon,
  Rows3Icon,
  Table2Icon,
  Trash2Icon,
  Undo2Icon,
  WrapTextIcon,
} from "lucide-react";
import { useEffect, useRef } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import "./markdown-rich-editor.css";

export function markdownTableCells(text: string): string[] | null {
  const lines = text
    .trim()
    .split(/\r?\n/)
    .map((line) => line.trim());
  if (
    lines.length < 2 ||
    lines.some(
      (line) =>
        !line.startsWith("|") || !line.endsWith("|") || line.includes("\\|"),
    )
  ) {
    return null;
  }
  const rows = lines.map((line) =>
    line
      .slice(1, -1)
      .split("|")
      .map((cell) => cell.trim()),
  );
  const width = rows[0]?.length ?? 0;
  if (
    !width ||
    rows.some((row) => row.length !== width) ||
    !rows[1]?.every((cell) => /^:?-{3,}:?$/.test(cell))
  ) {
    return null;
  }
  return [rows[0]!, ...rows.slice(2)].flat();
}

function documentTableCells(table: ProseMirrorNode): string[] {
  const cells: string[] = [];
  table.forEach((row) => {
    if (row.type.name !== "tableRow") return;
    row.forEach((cell) => {
      cells.push(cell.textContent.trim());
    });
  });
  return cells;
}

function sameCells(left: string[], right: string[]): boolean {
  return (
    left.length === right.length &&
    left.every((cell, index) => cell === right[index])
  );
}

function firstTableTextPosition(
  table: ProseMirrorNode,
  tablePosition: number,
): number | null {
  let target: number | null = null;
  table.descendants((node, position) => {
    if (target !== null) return false;
    if (!node.isTextblock) return true;
    target = tablePosition + position + 2;
    return false;
  });
  return target;
}

export function MarkdownRichEditor({
  value,
  disabled,
  onChange,
  onSave,
  requireFocusForChange = false,
  sourceAnchors = [],
  sourceFocusRequest,
  onSourceAnchorFocus,
  onScrollContainerChange,
}: {
  value: string;
  disabled?: boolean;
  onChange: (value: string) => void;
  onSave?: () => void;
  requireFocusForChange?: boolean;
  sourceAnchors?: Array<{ id: string; text: string }>;
  sourceFocusRequest?: { id: string; sequence: number } | null;
  onSourceAnchorFocus?: (id: string | null) => void;
  onScrollContainerChange?: (element: HTMLDivElement | null) => void;
}) {
  const sourceAnchorsRef = useRef(sourceAnchors);
  const onSourceAnchorFocusRef = useRef(onSourceAnchorFocus);
  sourceAnchorsRef.current = sourceAnchors;
  onSourceAnchorFocusRef.current = onSourceAnchorFocus;
  const editor = useEditor({
    immediatelyRender: false,
    editable: !disabled,
    content: value,
    contentType: "markdown",
    extensions: [
      StarterKit.configure({
        link: {
          openOnClick: false,
          protocols: [{ scheme: "citation", optionalSlashes: true }],
        },
      }),
      TableKit.configure({
        table: {
          resizable: false,
          HTMLAttributes: { class: "matrix-markdown-table" },
        },
      }),
      Markdown.configure({
        markedOptions: { gfm: true, breaks: false },
      }),
    ],
    editorProps: {
      attributes: {
        class:
          "matrix-markdown-editor min-h-full px-5 py-4 text-sm leading-7 outline-none",
        spellcheck: "true",
        "aria-label": "文书可视化编辑器",
      },
      handleKeyDown: (_view, event) => {
        if (
          (event.metaKey || event.ctrlKey) &&
          event.key.toLowerCase() === "s"
        ) {
          event.preventDefault();
          onSave?.();
          return true;
        }
        return false;
      },
    },
    onUpdate: ({ editor: nextEditor }) => {
      if (requireFocusForChange && !nextEditor.isFocused) return;
      onChange(nextEditor.getMarkdown());
    },
    onSelectionUpdate: ({ editor: nextEditor }) => {
      const from = nextEditor.state.selection.$from;
      const tableDepth = Array.from(
        { length: from.depth + 1 },
        (_, depth) => depth,
      )
        .reverse()
        .find((depth) => from.node(depth).type.name === "table");
      const matches =
        tableDepth === undefined
          ? sourceAnchorsRef.current.filter(
              (item) =>
                item.text.trim() === from.parent.textContent.trim() &&
                item.text.trim().length > 0,
            )
          : sourceAnchorsRef.current.filter((item) => {
              const cells = markdownTableCells(item.text);
              return (
                cells !== null &&
                sameCells(cells, documentTableCells(from.node(tableDepth)))
              );
            });
      onSourceAnchorFocusRef.current?.(
        matches.length === 1 ? matches[0]!.id : null,
      );
    },
  });

  useEffect(() => {
    editor?.setEditable(!disabled);
  }, [disabled, editor]);

  useEffect(() => {
    if (!editor || editor.getMarkdown() === value) return;
    editor.commands.setContent(value, {
      contentType: "markdown",
      emitUpdate: false,
    });
  }, [editor, value]);

  useEffect(() => {
    if (!editor || !sourceFocusRequest) return;
    const anchor = sourceAnchorsRef.current.find(
      (item) => item.id === sourceFocusRequest.id,
    );
    if (!anchor?.text.trim()) return;
    const sourceCells = markdownTableCells(anchor.text);
    const targetPositions: number[] = [];
    editor.state.doc.descendants((node, position) => {
      if (
        sourceCells !== null &&
        node.type.name === "table" &&
        sameCells(sourceCells, documentTableCells(node))
      ) {
        const tableTextPosition = firstTableTextPosition(node, position);
        if (tableTextPosition !== null) targetPositions.push(tableTextPosition);
        return false;
      }
      if (
        sourceCells === null &&
        node.isTextblock &&
        node.textContent.trim() === anchor.text.trim()
      ) {
        targetPositions.push(position + 1);
      }
      return true;
    });
    if (targetPositions.length === 1) {
      editor
        .chain()
        .focus()
        .setTextSelection(targetPositions[0]!)
        .scrollIntoView()
        .run();
    }
  }, [editor, sourceFocusRequest]);

  if (!editor) {
    return (
      <div className="text-muted-foreground flex size-full items-center justify-center text-sm">
        正在加载可视化编辑器…
      </div>
    );
  }
  const isDisabled = disabled === true;

  const toolbar = [
    {
      label: "正文",
      icon: WrapTextIcon,
      active: editor.isActive("paragraph"),
      action: () => editor.chain().focus().setParagraph().run(),
    },
    {
      label: "一级标题",
      icon: Heading1Icon,
      active: editor.isActive("heading", { level: 1 }),
      action: () => editor.chain().focus().toggleHeading({ level: 1 }).run(),
    },
    {
      label: "二级标题",
      icon: Heading2Icon,
      active: editor.isActive("heading", { level: 2 }),
      action: () => editor.chain().focus().toggleHeading({ level: 2 }).run(),
    },
    {
      label: "粗体",
      icon: BoldIcon,
      active: editor.isActive("bold"),
      action: () => editor.chain().focus().toggleBold().run(),
    },
    {
      label: "斜体",
      icon: ItalicIcon,
      active: editor.isActive("italic"),
      action: () => editor.chain().focus().toggleItalic().run(),
    },
    {
      label: "无序列表",
      icon: ListIcon,
      active: editor.isActive("bulletList"),
      action: () => editor.chain().focus().toggleBulletList().run(),
    },
    {
      label: "有序列表",
      icon: ListOrderedIcon,
      active: editor.isActive("orderedList"),
      action: () => editor.chain().focus().toggleOrderedList().run(),
    },
  ] as const;

  return (
    <div className="bg-background flex size-full min-h-0 flex-col">
      <div
        className="border-border bg-muted/20 flex shrink-0 flex-wrap items-center gap-1 border-b px-2 py-1.5"
        role="toolbar"
        aria-label="文书格式"
      >
        {toolbar.map(({ label, icon: Icon, active, action }) => (
          <Button
            key={label}
            type="button"
            size="icon-sm"
            variant="ghost"
            className={cn(active && "bg-accent text-accent-foreground")}
            aria-label={label}
            title={label}
            aria-pressed={active}
            disabled={disabled}
            onClick={action}
          >
            <Icon className="size-4" />
          </Button>
        ))}
        <span className="bg-border mx-1 h-5 w-px" aria-hidden="true" />
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          aria-label="插入表格"
          title="插入表格"
          disabled={isDisabled || editor.isActive("table")}
          onClick={() =>
            editor
              .chain()
              .focus()
              .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
              .run()
          }
        >
          <Table2Icon className="size-4" />
        </Button>
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          aria-label="增加表格行"
          title="增加表格行"
          disabled={isDisabled || !editor.can().addRowAfter()}
          onClick={() => editor.chain().focus().addRowAfter().run()}
        >
          <Rows3Icon className="size-4" />
        </Button>
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          aria-label="删除表格"
          title="删除表格"
          disabled={isDisabled || !editor.can().deleteTable()}
          onClick={() => editor.chain().focus().deleteTable().run()}
        >
          <Trash2Icon className="size-4" />
        </Button>
        <span className="bg-border mx-1 h-5 w-px" aria-hidden="true" />
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          aria-label="撤销"
          title="撤销"
          disabled={isDisabled || !editor.can().undo()}
          onClick={() => editor.chain().focus().undo().run()}
        >
          <Undo2Icon className="size-4" />
        </Button>
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          aria-label="重做"
          title="重做"
          disabled={isDisabled || !editor.can().redo()}
          onClick={() => editor.chain().focus().redo().run()}
        >
          <Redo2Icon className="size-4" />
        </Button>
      </div>
      <div ref={onScrollContainerChange} className="min-h-0 flex-1 overflow-auto">
        <EditorContent editor={editor} className="min-h-full" />
      </div>
    </div>
  );
}
