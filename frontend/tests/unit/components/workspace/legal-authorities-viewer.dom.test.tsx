import { afterEach, describe, expect, it, rs } from "@rstest/core";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";

rs.mock("@/core/law", () => ({ getCitation: rs.fn() }));

import { LegalAuthoritiesViewer } from "@/components/workspace/law/legal-authorities-viewer";
import { getCitation, type OcrCitation } from "@/core/law";
import { type LegalAuthorities } from "@/core/law/legal-authorities";
import { convertLegacyLawRefs } from "@/core/law/legal-authorities-import";

import fixture from "../../../fixtures/legal-authorities.json";

const document = fixture as LegalAuthorities;
const scope = { tenant_id: "tenant", matter_id: "matter" };
const citation = {
  id: "00000000-0000-0000-0000-000000000001",
  evidence_item_id: "00000000-0000-0000-0000-000000000002",
  evidence_version_id: "00000000-0000-0000-0000-000000000003",
  physical_page_number: 2,
  source_state: "archived",
  ocr_result_state: "superseded",
  quote_text: "合成冻结引文 <script>不执行</script>",
} as OcrCitation;
function expandEntry() {
  fireEvent.click(screen.getByText("合成示例法 第一条"));
}
function openCitation() {
  expandEntry();
  fireEvent.click(
    screen.getByRole("button", { name: "查看项目材料引用 · citation-1" }),
  );
}
afterEach(() => {
  cleanup();
  rs.resetAllMocks();
});

describe("right-panel legal authorities", () => {
  it("shows a missing legacy body and inert original record without reading a citation", async () => {
    const { authorities } = await convertLegacyLawRefs(
      new TextEncoder().encode(
        JSON.stringify([
          {
            code: "仅引用示例法",
            article: "第七条",
            origin: "mining",
            addedAt: "旧值",
            source: "javascript:alert(1)",
            articleId: "",
            text: null,
          },
        ]),
      ),
      { title: "旧记录", question: "尚待核验" },
    );
    render(<LegalAuthoritiesViewer document={authorities} scope={scope} />);
    fireEvent.click(
      screen.getByRole("button", { name: /仅引用示例法 第七条/ }),
    );
    expect(screen.getAllByText(/仅引用（正文缺失）/).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: /查看旧收藏引用记录/ }));
    expect(screen.getByText(/不是官方正文或已授权项目引用/)).toBeDefined();
    expect(screen.getAllByText(/javascript:alert/).length).toBeGreaterThan(0);
    expect(screen.queryByRole("link")).toBeNull();
    expect(getCitation).not.toHaveBeenCalled();
  });
  it("separates excerpt, analysis, incomplete dates and unverified external sources without fetching", () => {
    render(<LegalAuthoritiesViewer document={document} scope={scope} />);
    expandEntry();
    expect(screen.getByText("适用性分析（非条文原文）")).toBeDefined();
    expect(screen.getByText("2024-02", { exact: true })).toBeDefined();
    fireEvent.click(
      screen.getByRole("button", { name: "查看网页捕获 · web-1" }),
    );
    expect(screen.getByText("完整性：自述完整（未独立核验）")).toBeDefined();
    expect(screen.getByRole("link").getAttribute("rel")).toBe(
      "noopener noreferrer",
    );
    expect(getCitation).not.toHaveBeenCalled();
    expect(screen.queryByText("2024-02-01")).toBeNull();
  });
  it("filters without deleting removed entries or old import provenance", () => {
    render(<LegalAuthoritiesViewer document={document} />);
    fireEvent.change(screen.getByLabelText("依据收录状态"), {
      target: { value: "removed" },
    });
    expect(screen.queryByText("合成示例法 第一条")).toBeNull();
    fireEvent.click(screen.getByText("已移除示例法 第二条"));
    expect(screen.getByText(/合成复核认为与问题无关/)).toBeDefined();
    expect(screen.getByText("旧引用原始记录（未核验）")).toBeDefined();
    fireEvent.change(screen.getByLabelText("搜索法律依据"), {
      target: { value: "不存在" },
    });
    expect(screen.getByText("没有符合筛选条件的依据。")).toBeDefined();
    expect(document.entries).toHaveLength(2);
  });
  it("refuses citation reads without a trusted scope", () => {
    render(<LegalAuthoritiesViewer document={document} />);
    openCitation();
    expect(screen.getByText("项目归属尚未确认，不能读取来源。")).toBeDefined();
    expect(getCitation).not.toHaveBeenCalled();
  });
  it("loads immutable citation identity, labels superseded/archived and clears quote on denied reread", async () => {
    rs.mocked(getCitation)
      .mockResolvedValueOnce(citation)
      .mockRejectedValueOnce(new Error("denied"));
    render(<LegalAuthoritiesViewer document={document} scope={scope} />);
    openCitation();
    await screen.findByText(citation.quote_text!);
    expect(screen.getByText(/原材料已归档.*历史 OCR 版本/)).toBeDefined();
    expect(window.document.querySelector("script")).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: "收起项目材料引用 · citation-1" }),
    );
    expect(screen.queryByText(citation.quote_text!)).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: "查看项目材料引用 · citation-1" }),
    );
    await screen.findByRole("alert");
    expect(screen.queryByText(citation.quote_text!)).toBeNull();
    expect(getCitation).toHaveBeenLastCalledWith(
      "tenant",
      "matter",
      citation.evidence_item_id,
      citation.evidence_version_id,
      citation.id,
      expect.any(AbortSignal),
    );
  });
  it("aborts old project reads and ignores late responses", async () => {
    let resolve!: (value: OcrCitation) => void;
    rs.mocked(getCitation)
      .mockReturnValueOnce(
        new Promise((done) => {
          resolve = done;
        }),
      )
      .mockRejectedValueOnce(new Error("denied"));
    const view = render(
      <LegalAuthoritiesViewer document={document} scope={scope} />,
    );
    openCitation();
    const signal = rs.mocked(getCitation).mock.calls[0]![5]!;
    view.rerender(
      <LegalAuthoritiesViewer
        document={document}
        scope={{ ...scope, matter_id: "other" }}
      />,
    );
    await screen.findByRole("alert");
    expect(signal.aborted).toBe(true);
    await act(async () => {
      resolve(citation);
    });
    expect(screen.queryByText(citation.quote_text!)).toBeNull();
  });
  it("rejects mismatched citation responses and cancels pending reads on unmount", async () => {
    rs.mocked(getCitation).mockResolvedValue({
      ...citation,
      evidence_version_id: "wrong",
    });
    const view = render(
      <LegalAuthoritiesViewer document={document} scope={scope} />,
    );
    openCitation();
    await screen.findByRole("alert");
    expect(screen.queryByText(citation.quote_text!)).toBeNull();
    const signal = rs.mocked(getCitation).mock.calls[0]![5]!;
    view.unmount();
    await waitFor(() => expect(signal.aborted).toBe(true));
  });
});
