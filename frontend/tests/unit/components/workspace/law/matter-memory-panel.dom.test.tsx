import { afterEach, beforeEach, describe, expect, it, rs } from "@rstest/core";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

rs.mock("@/core/law", () => ({
  useDecideLawMatterMemory: rs.fn(),
  useLawMatterMemory: rs.fn(),
}));

import { MatterMemoryPanel } from "@/components/workspace/law/matter-memory-panel";
import { useDecideLawMatterMemory, useLawMatterMemory } from "@/core/law";

const mutate = rs.fn();
const refetch = rs.fn();

const entry = {
  id: "memory-1",
  title: "合同交付日期待核对",
  content: "对方主张的交付日与合同约定不一致，需律师核验。",
  content_sha256: "a".repeat(64),
  status: "proposed" as const,
  version: 0,
  decision_note: null,
  decided_at: null,
  created_at: "2026-10-03T00:00:00Z",
  sources: [
    {
      citation_id: "citation-1",
      evidence_item_id: "evidence-1",
      evidence_title: "合同扫描件",
      evidence_version_id: "version-1",
      evidence_sha256: "b".repeat(64),
      publication_id: "publication-1",
      publication_number: 2,
      publication_state: "current" as const,
      publication_sha256: "c".repeat(64),
      publication_manifest_sha256: "d".repeat(64),
      physical_page_number: 6,
      page_sha256: "e".repeat(64),
      quote_text: "交付日期：2026年3月31日。",
      quote_sha256: "f".repeat(64),
      source_state: "available" as const,
    },
  ],
};

beforeEach(() => {
  mutate.mockReset();
  refetch.mockReset();
  rs.mocked(useLawMatterMemory).mockReturnValue({
    data: { items: [entry], can_review: true },
    isPending: false,
    isError: false,
    isFetching: false,
    refetch,
  } as unknown as ReturnType<typeof useLawMatterMemory>);
  rs.mocked(useDecideLawMatterMemory).mockReturnValue({
    mutate,
    isPending: false,
    isError: false,
  } as unknown as ReturnType<typeof useDecideLawMatterMemory>);
});

afterEach(() => cleanup());

describe("matter memory review panel", () => {
  it("shows a proposed note with fixed citation source details and records a versioned approval", async () => {
    render(<MatterMemoryPanel tenantId="tenant-1" matterId="matter-1" />);

    expect(screen.getByText("待律师审核")).toBeTruthy();
    expect(screen.getByText("合同扫描件 · 第 6 页")).toBeTruthy();
    expect(screen.getByText("交付日期：2026年3月31日。")).toBeTruthy();
    expect(screen.getByText(`材料版本 SHA-256 ${"b".repeat(64)} · 校对版本 2 · 页面 SHA-256 ${"e".repeat(64)}`)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "批准" }));
    await waitFor(() =>
      expect(mutate).toHaveBeenCalledWith({
        entryId: "memory-1",
        input: { decision: "approved", expected_version: 0 },
      }),
    );
  });

  it("keeps review actions hidden for a read-only matter member", () => {
    rs.mocked(useLawMatterMemory).mockReturnValue({
      data: { items: [entry], can_review: false },
      isPending: false,
      isError: false,
      isFetching: false,
      refetch,
    } as unknown as ReturnType<typeof useLawMatterMemory>);
    render(<MatterMemoryPanel tenantId="tenant-1" matterId="matter-1" />);

    expect(screen.queryByRole("button", { name: "批准" })).toBeNull();
    expect(screen.getByText(/审核操作需要案件负责人/)).toBeTruthy();
  });
});
