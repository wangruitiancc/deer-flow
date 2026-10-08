import { afterEach, beforeEach, describe, expect, it, rs } from "@rstest/core";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";

rs.mock("@/core/law", () => ({
  useCreateLawCitation: rs.fn(),
  useLawOcrProofreadingCollection: rs.fn(),
  useLawOcrProofreadingPublication: rs.fn(),
  usePublishLawOcrProofreading: rs.fn(),
}));

import { OcrProofreadingPublicationBar } from "@/components/workspace/law/ocr-proofreading-publication-bar";
import {
  useCreateLawCitation,
  useLawOcrProofreadingCollection,
  useLawOcrProofreadingPublication,
  usePublishLawOcrProofreading,
} from "@/core/law";

const publish = rs.fn();
const refetch = rs.fn();
const createCitation = rs.fn();

beforeEach(() => {
  publish.mockReset();
  createCitation.mockReset();
  refetch.mockReset();
  const collection = {
    ocr_page_drafts: [
      {
        id: "draft-1",
        physical_page_number: 1,
        status: "reviewed",
        version: 3,
      },
    ],
    expected_page_numbers: [1, 2],
    recognized_page_numbers: [1],
    missing_page_numbers: [2],
    latest_publication: null,
  };
  refetch.mockResolvedValue({ data: collection });
  rs.mocked(useLawOcrProofreadingCollection).mockReturnValue({
    data: collection,
    isPending: false,
    error: null,
    refetch,
  } as unknown as ReturnType<typeof useLawOcrProofreadingCollection>);
  rs.mocked(usePublishLawOcrProofreading).mockReturnValue({
    mutateAsync: publish,
    isPending: false,
    error: null,
  } as unknown as ReturnType<typeof usePublishLawOcrProofreading>);
  rs.mocked(useLawOcrProofreadingPublication).mockReturnValue({
    data: undefined,
    isPending: false,
    error: null,
  } as unknown as ReturnType<typeof useLawOcrProofreadingPublication>);
  rs.mocked(useCreateLawCitation).mockReturnValue({
    mutateAsync: createCitation,
    isPending: false,
    error: null,
    reset: rs.fn(),
  } as unknown as ReturnType<typeof useCreateLawCitation>);
});

afterEach(() => cleanup());

describe("OCR proofreading publication bar", () => {
  it("saves the current page before publishing an explicit partial snapshot", async () => {
    const beforePublish = rs.fn().mockResolvedValue(undefined);
    render(
      <OcrProofreadingPublicationBar
        tenantId="tenant"
        matterId="matter"
        evidenceItemId="evidence"
        evidenceVersionId="version"
        locale="zh-CN"
        currentPageNumber={1}
        onBeforePublish={beforePublish}
      />,
    );

    expect(screen.getByText(/已保存 1\/2 个已选页面/)).toBeTruthy();
    expect(screen.getByText(/第 2 页缺少校对稿或 OCR 结果/)).toBeTruthy();
    expect(screen.getByText("更多操作").closest("details")?.open).toBe(false);
    expect(screen.getByText("查看成果与引用").closest("details")?.open).toBe(
      false,
    );
    expect(screen.getByText(/生成成果不等于全部文字已通过复核/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "生成部分成果" }));

    await waitFor(() => expect(beforePublish).toHaveBeenCalledTimes(1));
    expect(refetch).toHaveBeenCalledTimes(1);
    expect(publish).toHaveBeenCalledWith({
      expectedVersions: { 1: 3 },
      allowPartial: true,
      tableMerges: [],
    });
  });

  it("creates a citation from the selected immutable publication text using Unicode offsets", async () => {
    const latest = {
      id: "publication-1",
      publication_number: 4,
      status: "complete" as const,
      page_count: 1,
      reviewed_page_count: 1,
      recognized_page_numbers: [1],
      missing_page_numbers: [],
      markdown_sha256: "a".repeat(64),
      manifest_sha256: "b".repeat(64),
      created_at: "2026-09-23T00:00:00Z",
    };
    rs.mocked(useLawOcrProofreadingCollection).mockReturnValue({
      data: {
        ocr_page_drafts: [],
        expected_page_numbers: [1],
        recognized_page_numbers: [1],
        missing_page_numbers: [],
        latest_publication: latest,
      },
      isPending: false,
      error: null,
      refetch,
    } as unknown as ReturnType<typeof useLawOcrProofreadingCollection>);
    rs.mocked(useLawOcrProofreadingPublication).mockReturnValue({
      data: {
        ...latest,
        markdown_text: "甲😀乙",
        manifest: {},
        pages: [
          {
            physical_page_number: 1,
            draft_id: "draft-1",
            draft_revision_number: 1,
            draft_status: "reviewed",
            markdown_sha256: "c".repeat(64),
            markdown_start_character: 0,
            markdown_end_character: 3,
            source_ocr_job_id: "job-1",
            source_ocr_result_id: "result-1",
            source_ocr_page_id: "page-1",
            source_text_sha256: "d".repeat(64),
            source_block_ids: ["block-1"],
          },
        ],
      },
      isPending: false,
      error: null,
    } as unknown as ReturnType<typeof useLawOcrProofreadingPublication>);
    createCitation.mockResolvedValue({ id: "citation-1" });

    render(
      <OcrProofreadingPublicationBar
        tenantId="tenant"
        matterId="matter"
        evidenceItemId="evidence"
        evidenceVersionId="version"
        locale="zh-CN"
        currentPageNumber={1}
        onBeforePublish={rs.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "引用已发布文字" }));
    const text = await screen.findByRole("textbox", {
      name: "请先在已发布页面中选择需要引用的文字。",
    });
    Object.defineProperties(text, {
      selectionStart: { configurable: true, value: 1 },
      selectionEnd: { configurable: true, value: 3 },
    });
    fireEvent.select(text);
    fireEvent.click(screen.getByRole("button", { name: "创建正式引用" }));

    await waitFor(() =>
      expect(createCitation).toHaveBeenCalledWith({
        source_type: "proofreading_publication",
        publication_id: "publication-1",
        physical_page_number: 1,
        start_character: 1,
        end_character: 2,
      }),
    );
  });
});
