import { afterEach, beforeEach, describe, expect, it, rs } from "@rstest/core";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { useEffect } from "react";

rs.mock("@/core/law/hooks", () => ({
  useLawOcrPageDraft: rs.fn(),
  useSaveLawOcrPageDraft: rs.fn(),
  useReviewLawOcrPageDraft: rs.fn(),
}));
rs.mock("@/components/workspace/artifacts/markdown-rich-editor", () => ({
  MarkdownRichEditor: ({
    value,
    onChange,
  }: {
    value: string;
    onChange: (value: string) => void;
  }) => {
    useEffect(() => {
      onChange(value);
    }, [value, onChange]);
    return (
      <textarea
        aria-label="mock-rich-editor"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    );
  },
}));

import { OcrProofreadingEditor } from "@/components/workspace/law/ocr-proofreading-editor";
import {
  useLawOcrPageDraft,
  useReviewLawOcrPageDraft,
  useSaveLawOcrPageDraft,
} from "@/core/law/hooks";
import type { OcrPageDraft } from "@/core/law/types";

const baseline: OcrPageDraft = {
  id: null,
  physical_page_number: 1,
  source_ocr_job_id: "job",
  source_ocr_result_id: "result",
  source_ocr_page_id: "page",
  source_text_sha256: "a".repeat(64),
  source_block_ids: ["block"],
  markdown_text: "OCR 原文",
  markdown_sha256: "b".repeat(64),
  status: "draft",
  version: 0,
  source_changed: false,
  reviewed_at: null,
  created_at: null,
  updated_at: null,
};

const save = rs.fn();
const review = rs.fn();

beforeEach(() => {
  save.mockReset();
  review.mockReset();
  rs.mocked(useLawOcrPageDraft).mockReturnValue({
    data: baseline,
    isPending: false,
    error: null,
    refetch: rs.fn(),
  } as unknown as ReturnType<typeof useLawOcrPageDraft>);
  rs.mocked(useSaveLawOcrPageDraft).mockReturnValue({
    mutateAsync: save,
    reset: rs.fn(),
    isPending: false,
    error: null,
  } as unknown as ReturnType<typeof useSaveLawOcrPageDraft>);
  rs.mocked(useReviewLawOcrPageDraft).mockReturnValue({
    mutateAsync: review,
    isPending: false,
    error: null,
  } as unknown as ReturnType<typeof useReviewLawOcrPageDraft>);
});

afterEach(() => cleanup());

function renderEditor() {
  return render(
    <OcrProofreadingEditor
      tenantId="tenant"
      matterId="matter"
      evidenceItemId="evidence"
      evidenceVersionId="version"
      physicalPageNumber={1}
      ocrJobId="job"
      locale="zh-CN"
    />,
  );
}

describe("OCR proofreading editor", () => {
  it("shows saved and reviewed states without repeat action buttons", () => {
    rs.mocked(useLawOcrPageDraft).mockReturnValue({
      data: {
        ...baseline,
        status: "reviewed",
        version: 2,
        updated_at: "2026-10-03T01:00:00Z",
      },
      isPending: false,
      error: null,
      refetch: rs.fn(),
    } as unknown as ReturnType<typeof useLawOcrPageDraft>);
    renderEditor();
    expect(screen.queryByRole("button", { name: "保存修改" })).toBeNull();
    expect(
      screen.queryByRole("button", { name: "确认本页校对完成" }),
    ).toBeNull();
    expect(screen.getByText("本页已校对")).toBeTruthy();
    expect(save).not.toHaveBeenCalled();
    expect(review).not.toHaveBeenCalled();
  });
  it("loads the server draft before mounting the rich editor", async () => {
    rs.mocked(useLawOcrPageDraft).mockReturnValue({
      data: undefined,
      isPending: true,
      error: null,
      refetch: rs.fn(),
    } as unknown as ReturnType<typeof useLawOcrPageDraft>);
    const view = renderEditor();
    expect(screen.queryByLabelText("mock-rich-editor")).toBeNull();
    rs.mocked(useLawOcrPageDraft).mockReturnValue({
      data: { ...baseline, id: "saved-draft", version: 2, status: "reviewed" },
      isPending: false,
      error: null,
      refetch: rs.fn(),
    } as unknown as ReturnType<typeof useLawOcrPageDraft>);
    view.rerender(
      <OcrProofreadingEditor
        tenantId="tenant"
        matterId="matter"
        evidenceItemId="evidence"
        evidenceVersionId="version"
        physicalPageNumber={1}
        ocrJobId="job"
        locale="zh-CN"
      />,
    );
    const editor = await screen.findByLabelText("mock-rich-editor");
    if (!(editor instanceof HTMLTextAreaElement))
      throw new Error("rich editor is not a textarea");
    expect(editor.value).toBe("OCR 原文");
    await new Promise((resolve) => setTimeout(resolve, 1100));
    expect(save).not.toHaveBeenCalled();
    expect(screen.getByText("本页已校对")).toBeTruthy();
  });

  it("keeps the baseline local and saves with optimistic version fencing", async () => {
    save.mockResolvedValue({
      ...baseline,
      id: "draft",
      markdown_text: "律师修改",
      version: 1,
      updated_at: "2026-09-23T00:00:00Z",
    });
    renderEditor();
    const editor = await screen.findByLabelText("mock-rich-editor");
    if (!(editor instanceof HTMLTextAreaElement))
      throw new Error("rich editor is not a textarea");
    fireEvent.change(editor, { target: { value: "律师修改" } });
    fireEvent.click(screen.getByRole("button", { name: "保存修改" }));

    await waitFor(() =>
      expect(save).toHaveBeenCalledWith({
        markdownText: "律师修改",
        expectedVersion: 0,
      }),
    );
  });

  it("warns without replacing a saved draft when a newer OCR source exists", () => {
    rs.mocked(useLawOcrPageDraft).mockReturnValue({
      data: { ...baseline, id: "draft", version: 3, source_changed: true },
      isPending: false,
      error: null,
      refetch: rs.fn(),
    } as unknown as ReturnType<typeof useLawOcrPageDraft>);

    renderEditor();
    expect(
      screen.getByText(
        "检测到新的 OCR 候选结果；现有校对稿已保留，没有被自动覆盖。",
      ),
    ).toBeTruthy();
  });

  it("keeps the current page editor and unsaved text when later OCR results refresh", async () => {
    const view = renderEditor();
    const editor = await screen.findByLabelText("mock-rich-editor");
    if (!(editor instanceof HTMLTextAreaElement))
      throw new Error("rich editor is not a textarea");
    fireEvent.change(editor, { target: { value: "正在校对第一页" } });
    view.rerender(
      <OcrProofreadingEditor
        tenantId="tenant"
        matterId="matter"
        evidenceItemId="evidence"
        evidenceVersionId="version"
        physicalPageNumber={1}
        ocrJobId="job"
        locale="zh-CN"
        sourceBlocks={[]}
      />,
    );
    expect(screen.getByLabelText("mock-rich-editor")).toBe(editor);
    expect(editor.value).toBe("正在校对第一页");
    expect(save).not.toHaveBeenCalled();
  });

  it("keeps formulas and merged tables in source mode and saves exact Markdown", async () => {
    const complex =
      '$$\nE=mc^2\n$$\n<table><tr><td rowspan="2">证据</td></tr></table>';
    rs.mocked(useLawOcrPageDraft).mockReturnValue({
      data: { ...baseline, markdown_text: complex },
      isPending: false,
      error: null,
      refetch: rs.fn(),
    } as unknown as ReturnType<typeof useLawOcrPageDraft>);
    save.mockImplementation(async ({ markdownText }) => ({
      ...baseline,
      markdown_text: markdownText,
      version: 1,
    }));

    renderEditor();
    expect(screen.queryByLabelText("mock-rich-editor")).toBeNull();
    const source = screen.getByRole("textbox");
    if (!(source instanceof HTMLTextAreaElement))
      throw new Error("source editor is not a textarea");
    expect(source.value).toBe(complex);
    const visualButton = screen.getByRole("button", { name: "可视化" });
    if (!(visualButton instanceof HTMLButtonElement))
      throw new Error("visual action is not a button");
    expect(visualButton.disabled).toBe(true);
    fireEvent.change(source, { target: { value: `${complex}\n律师注释` } });
    fireEvent.click(screen.getByRole("button", { name: "保存修改" }));
    await waitFor(() =>
      expect(save).toHaveBeenCalledWith({
        markdownText: `${complex}\n律师注释`,
        expectedVersion: 0,
      }),
    );
  });

  it("locates an unchanged merged-table source in the Markdown editor and maps caret back", async () => {
    const table = '<table><tr><td rowspan="2">证据金额</td></tr></table>';
    const markdown = `标题\n${table}\n页脚`;
    rs.mocked(useLawOcrPageDraft).mockReturnValue({
      data: { ...baseline, markdown_text: markdown },
      isPending: false,
      error: null,
      refetch: rs.fn(),
    } as unknown as ReturnType<typeof useLawOcrPageDraft>);
    const onSourceBlockFocus = rs.fn();
    const props = {
      tenantId: "tenant",
      matterId: "matter",
      evidenceItemId: "evidence",
      evidenceVersionId: "version",
      physicalPageNumber: 1,
      ocrJobId: "job",
      locale: "zh-CN" as const,
      sourceBlocks: [{ id: "table", text: table }],
      onSourceBlockFocus,
    };
    const view = render(<OcrProofreadingEditor {...props} />);
    const source = screen.getByRole("textbox");
    if (!(source instanceof HTMLTextAreaElement))
      throw new Error("source editor is not a textarea");
    view.rerender(
      <OcrProofreadingEditor
        {...props}
        sourceFocusRequest={{ id: "table", sequence: 1 }}
      />,
    );
    await waitFor(() => {
      expect(source.selectionStart).toBe(markdown.indexOf(table));
      expect(source.selectionEnd).toBe(markdown.indexOf(table) + table.length);
    });
    onSourceBlockFocus.mockClear();
    source.setSelectionRange(
      markdown.indexOf("证据金额"),
      markdown.indexOf("证据金额"),
    );
    fireEvent.select(source);
    expect(onSourceBlockFocus).toHaveBeenCalledWith("table");
    source.setSelectionRange(0, 0);
    fireEvent.select(source);
    expect(onSourceBlockFocus).toHaveBeenLastCalledWith(null);
  });
});
