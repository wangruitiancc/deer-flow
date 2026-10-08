import { afterEach, beforeEach, describe, expect, it, rs } from "@rstest/core";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";

rs.mock("@/core/law", () => ({
  getCitation: rs.fn(),
  listCitations: rs.fn(),
  listEvidence: rs.fn(),
  listEvidenceVersions: rs.fn(),
}));

import { LegalGraphSourceMapping } from "@/components/workspace/law/legal-graph-source-mapping";
import {
  getCitation,
  listCitations,
  listEvidence,
  listEvidenceVersions,
} from "@/core/law";
import { type LegalGraph } from "@/core/law/legal-graph";
import {
  type EvidenceItem,
  type EvidenceVersion,
  type OcrCitation,
} from "@/core/law/types";

const scope = { tenant_id: "tenant", matter_id: "matter" };
const source = {
  id: "s",
  kind: "legacy_unmapped" as const,
  reference: "javascript:old-path",
  quote: "旧摘录",
};
const graph: LegalGraph = {
  format: "matrix-law.legal-graph",
  schema_version: 1,
  title: "合成图谱",
  nodes: [],
  edges: [],
  sources: [source],
};
const citation = {
  id: "00000000-0000-4000-8000-000000000001",
  evidence_item_id: "00000000-0000-4000-8000-000000000002",
  evidence_version_id: "00000000-0000-4000-8000-000000000003",
  quote_text: "受保护的合成原文",
  physical_page_number: 3,
  source_state: "available",
  ocr_result_state: "current",
} as OcrCitation;
const onChange = rs.fn();
const onClose = rs.fn();
beforeEach(() => {
  rs.clearAllMocks();
  rs.mocked(listEvidence).mockResolvedValue([
    {
      id: citation.evidence_item_id,
      title: "当前合成证据",
      status: "active",
    } as EvidenceItem,
  ]);
  rs.mocked(listEvidenceVersions).mockResolvedValue([
    {
      id: citation.evidence_version_id,
      version_number: 1,
      original_filename: "source.pdf",
    } as EvidenceVersion,
  ]);
  rs.mocked(listCitations).mockResolvedValue([
    { ...citation, quote_text: undefined, quote_preview: "摘要不能用于确认" },
  ]);
  rs.mocked(getCitation).mockResolvedValue(citation);
});
afterEach(cleanup);
function mount() {
  return render(
    <LegalGraphSourceMapping
      graph={graph}
      source={source}
      scope={scope}
      onChange={onChange}
      onClose={onClose}
    />,
  );
}
async function selectCitation() {
  await screen.findByRole("option", { name: /当前合成证据/ });
  fireEvent.change(screen.getByLabelText("当前项目材料"), {
    target: { value: citation.evidence_item_id },
  });
  await screen.findByRole("option", { name: /source.pdf/ });
  fireEvent.change(screen.getByLabelText("证据版本"), {
    target: { value: citation.evidence_version_id },
  });
  await screen.findByRole("option", { name: /摘要不能用于确认/ });
  fireEvent.change(screen.getByLabelText("已有引用"), {
    target: { value: citation.id },
  });
}
async function readAndConfirm() {
  fireEvent.click(screen.getByRole("button", { name: "读取受保护原文" }));
  await screen.findByText(citation.quote_text!);
  fireEvent.click(screen.getByRole("checkbox"));
}
const apply = () =>
  fireEvent.click(screen.getByRole("button", { name: "确认关联到图谱草稿" }));
describe("explicit protected source mapping", () => {
  it("requires full text and confirmation, then reauthorizes and only edits a draft", async () => {
    mount();
    await selectCitation();
    expect(
      screen
        .getByRole("button", { name: "确认关联到图谱草稿" })
        .hasAttribute("disabled"),
    ).toBe(true);
    expect(getCitation).not.toHaveBeenCalled();
    expect(document.querySelector('a[href^="javascript:"]')).toBeNull();
    await readAndConfirm();
    apply();
    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
    expect(getCitation).toHaveBeenCalledTimes(2);
    expect(onChange.mock.calls[0]![0].sources[0]).toMatchObject({
      kind: "citation",
      citation_id: citation.id,
      legacy_origin: source,
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
  it("clears protected text and refuses the draft after authorization is revoked", async () => {
    mount();
    await selectCitation();
    await readAndConfirm();
    rs.mocked(getCitation).mockRejectedValue(new Error("无权访问"));
    apply();
    await screen.findByRole("alert");
    expect(screen.queryByText(citation.quote_text!)).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });
  it("requires a new explicit confirmation if the source lifecycle changed", async () => {
    mount();
    await selectCitation();
    await readAndConfirm();
    rs.mocked(getCitation).mockResolvedValue({
      ...citation,
      source_state: "archived",
    });
    apply();
    expect((await screen.findByRole("alert")).textContent).toContain(
      "状态已变化",
    );
    expect(screen.getByRole<HTMLInputElement>("checkbox").checked).toBe(false);
    expect(onChange).not.toHaveBeenCalled();
  });
  it("does not apply or show late text after the graph baseline changes", async () => {
    const view = mount();
    await selectCitation();
    await readAndConfirm();
    let resolve!: (value: OcrCitation) => void;
    rs.mocked(getCitation).mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    apply();
    view.rerender(
      <LegalGraphSourceMapping
        graph={{ ...graph, title: "另一次编辑" }}
        source={source}
        scope={scope}
        onChange={onChange}
        onClose={onClose}
      />,
    );
    await act(async () => resolve(citation));
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.queryByText(citation.quote_text!)).toBeNull();
  });
  it("aborts a pending read when closed and ignores late responses", async () => {
    const view = mount();
    await selectCitation();
    let resolve!: (value: OcrCitation) => void;
    rs.mocked(getCitation).mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "读取受保护原文" }));
    const signal = rs.mocked(getCitation).mock.calls[0]![5]!;
    view.unmount();
    expect(signal.aborted).toBe(true);
    await act(async () => resolve(citation));
    expect(onChange).not.toHaveBeenCalled();
  });
  it("changing material clears the old quote, selection and confirmation", async () => {
    mount();
    await selectCitation();
    await readAndConfirm();
    fireEvent.change(screen.getByLabelText("当前项目材料"), {
      target: { value: "" },
    });
    expect(screen.queryByText(citation.quote_text!)).toBeNull();
    expect(screen.getByRole<HTMLInputElement>("checkbox").checked).toBe(false);
    expect(
      screen
        .getByRole("button", { name: "确认关联到图谱草稿" })
        .hasAttribute("disabled"),
    ).toBe(true);
  });
});
