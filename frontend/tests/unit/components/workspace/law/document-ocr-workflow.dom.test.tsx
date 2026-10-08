import { afterEach, beforeEach, describe, expect, it, rs } from "@rstest/core";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

rs.mock("@/core/law/hooks", () => ({
  useLawOcrWorkflows: rs.fn(),
  usePlanLawOcrWorkflow: rs.fn(),
  useTransitionLawOcrWorkflow: rs.fn(),
}));

import { DocumentOcrWorkflow } from "@/components/workspace/law/document-ocr-workflow";
import {
  useLawOcrWorkflows,
  usePlanLawOcrWorkflow,
  useTransitionLawOcrWorkflow,
} from "@/core/law/hooks";
import type { EvidenceVersion, OcrWorkflow } from "@/core/law/types";

const evidenceVersion = {
  id: "version",
  scan_status: "clean",
} as EvidenceVersion;

const plannedWorkflow = {
  id: "workflow",
  evidence_item_id: "evidence",
  evidence_version_id: "version",
  page_count: 45,
  selected_page_count: 45,
  target_segment_pages: 20,
  status: "planned",
  ready_pages: 0,
  terminal_pages: 0,
  failed_pages: 0,
  cancel_requested: false,
  version: 1,
  segments: [
    {
      id: "segment-1",
      sequence_number: 1,
      physical_pages: Array.from({ length: 20 }, (_, index) => index + 1),
      page_count: 20,
      resource_source: "tenant_default",
      status: "pending",
      ocr_job_id: null,
      last_error_code: null,
      started_at: null,
      completed_at: null,
    },
    {
      id: "segment-2",
      sequence_number: 2,
      physical_pages: Array.from({ length: 20 }, (_, index) => index + 21),
      page_count: 20,
      resource_source: "tenant_default",
      status: "pending",
      ocr_job_id: null,
      last_error_code: null,
      started_at: null,
      completed_at: null,
    },
    {
      id: "segment-3",
      sequence_number: 3,
      physical_pages: [41, 42, 43, 44, 45],
      page_count: 5,
      resource_source: "tenant_default",
      status: "pending",
      ocr_job_id: null,
      last_error_code: null,
      started_at: null,
      completed_at: null,
    },
  ],
  pages: [],
} as unknown as OcrWorkflow;

const planMutate = rs.fn();
const transitionMutate = rs.fn();

beforeEach(() => {
  planMutate.mockReset();
  transitionMutate.mockReset();
  rs.mocked(usePlanLawOcrWorkflow).mockReturnValue({
    mutate: planMutate,
    isPending: false,
    error: null,
  } as unknown as ReturnType<typeof usePlanLawOcrWorkflow>);
  rs.mocked(useTransitionLawOcrWorkflow).mockReturnValue({
    mutate: transitionMutate,
    isPending: false,
    error: null,
  } as unknown as ReturnType<typeof useTransitionLawOcrWorkflow>);
});

afterEach(() => cleanup());

function renderWorkflow() {
  return render(
    <DocumentOcrWorkflow
      tenantId="tenant"
      matterId="matter"
      evidenceItemId="evidence"
      evidenceVersion={evidenceVersion}
      locale="zh-CN"
      onOpenJob={rs.fn()}
    />,
  );
}

describe("document OCR workflow", () => {
  it("builds the page plan before starting recognition", () => {
    rs.mocked(useLawOcrWorkflows).mockReturnValue({
      data: [],
      isPending: false,
      error: null,
      refetch: rs.fn(),
    } as unknown as ReturnType<typeof useLawOcrWorkflows>);

    renderWorkflow();
    fireEvent.click(screen.getByRole("button", { name: "识别文字" }));

    expect(planMutate).toHaveBeenCalledWith({
      language: "auto",
      enable_table: true,
      enable_formula: false,
      target_segment_pages: 20,
      resource_source: "tenant_default",
    });
  });

  it("passes an explicit platform OCR choice into the page plan", () => {
    rs.mocked(useLawOcrWorkflows).mockReturnValue({
      data: [],
      isPending: false,
      error: null,
      refetch: rs.fn(),
    } as unknown as ReturnType<typeof useLawOcrWorkflows>);

    renderWorkflow();
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "platform_ocr" } });
    fireEvent.click(screen.getByRole("button", { name: "识别文字" }));

    expect(planMutate).toHaveBeenCalledWith(expect.objectContaining({
      resource_source: "platform_ocr",
    }));
  });

  it("shows the durable segment plan and starts with optimistic version fencing", () => {
    rs.mocked(useLawOcrWorkflows).mockReturnValue({
      data: [plannedWorkflow],
      isPending: false,
      error: null,
      refetch: rs.fn(),
    } as unknown as ReturnType<typeof useLawOcrWorkflows>);

    renderWorkflow();
    expect(screen.getByText("处理方案已生成：45 页，3 个页段")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "开始识别" }));

    expect(transitionMutate).toHaveBeenCalledWith({
      workflowId: "workflow",
      action: "start",
      expectedVersion: 1,
    });
  });
});
