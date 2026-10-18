import { afterEach, beforeEach, describe, expect, it, rs } from "@rstest/core";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";

rs.mock("@/core/law", () => ({ getCitation: rs.fn() }));
rs.mock("@/components/workspace/law/legal-graph-canvas", () => ({
  LegalGraphCanvas: () => <p>Canvas</p>,
}));

import { LegalGraphViewer } from "@/components/workspace/law/legal-graph-viewer";
import { getCitation } from "@/core/law";
import { type LegalGraph } from "@/core/law/legal-graph";

const graph: LegalGraph = {
  format: "matrix-law.legal-graph",
  schema_version: 1,
  title: "合成图谱",
  nodes: [
    {
      id: "p",
      label: "甲方",
      type: "party",
      category: "person",
      source_ids: [],
    },
    {
      id: "e",
      label: "签约",
      type: "event",
      category: "timeline",
      date: { value: "2024-02", origin: "legacy_inferred" },
      source_ids: ["s"],
    },
  ],
  edges: [
    {
      id: "r",
      source: "p",
      target: "e",
      label: "参与",
      category: "timeline",
      confidence: "INFERRED",
      source_ids: ["s"],
    },
  ],
  sources: [
    {
      id: "s",
      kind: "citation",
      citation_id: "citation",
      evidence_item_id: "item",
      evidence_version_id: "version",
    },
  ],
};

beforeEach(() => {
  rs.spyOn(window, "matchMedia").mockReturnValue({
    matches: false,
  } as MediaQueryList);
});
afterEach(() => {
  cleanup();
  rs.restoreAllMocks();
});
describe("legal graph native viewer", () => {
  it("reauthorizes framework sources after closing and reopening the framework panel", async () => {
    rs.mocked(getCitation).mockResolvedValue({
      quote_text: "合成框架依据",
      physical_page_number: 1,
      source_state: "available",
      ocr_result_state: "current",
    } as Awaited<ReturnType<typeof getCitation>>);
    const professional: LegalGraph = {
      ...graph,
      analysis: {
        registered_cause: null,
        matter_version: 1,
        case_labels: ["候选案由"],
        framework_source_ids: ["s"],
        element_node_ids: [],
        notes: [],
        frameworks: [],
      },
    };
    render(
      <LegalGraphViewer
        graph={professional}
        scope={{ tenant_id: "tenant", matter_id: "matter" }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "框架与依据" }));
    fireEvent.click(screen.getByRole("button", { name: "核验并查看引用" }));
    await screen.findByText("合成框架依据");
    const signal = rs.mocked(getCitation).mock.calls.at(-1)?.[5];
    fireEvent.click(screen.getByRole("button", { name: "关闭框架详情" }));
    expect(signal?.aborted).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "框架与依据" }));
    expect(screen.queryByText("合成框架依据")).toBeNull();
    rs.mocked(getCitation).mockRejectedValue(new Error("403"));
    fireEvent.click(screen.getByRole("button", { name: "核验并查看引用" }));
    await screen.findByRole("alert");
    expect(screen.queryByText("合成框架依据")).toBeNull();
  });
  it("supports list selection and precision-preserving timeline without raw HTML execution", () => {
    render(<LegalGraphViewer graph={graph} />);
    fireEvent.click(screen.getByRole("button", { name: /甲方 → 参与/ }));
    expect(screen.getAllByText("模型推断（待复核）").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "时间线" }));
    expect(screen.getByText("2024-02")).toBeDefined();
    expect(screen.getByText("旧版日期（依据待核验）")).toBeDefined();
    expect(
      screen
        .getByRole("button", { name: "核验并查看引用" })
        .hasAttribute("disabled"),
    ).toBe(true);
    fireEvent.change(screen.getByLabelText("搜索图谱节点或关系"), {
      target: { value: "不存在" },
    });
    expect(screen.getByText("没有匹配的节点或关系。")).toBeDefined();
  });
  it("rechecks a citation on every open and clears previous content on denial", async () => {
    rs.mocked(getCitation).mockResolvedValue({
      quote_text: "授权合成正文",
      physical_page_number: 1,
      source_state: "available",
      ocr_result_state: "current",
    } as Awaited<ReturnType<typeof getCitation>>);
    render(
      <LegalGraphViewer
        graph={graph}
        scope={{ tenant_id: "tenant", matter_id: "matter" }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /签约 事件/ }));
    fireEvent.click(screen.getByRole("button", { name: "核验并查看引用" }));
    await screen.findByText("授权合成正文");
    expect(rs.mocked(getCitation).mock.calls[0]?.slice(0, 5)).toEqual([
      "tenant",
      "matter",
      "item",
      "version",
      "citation",
    ]);
    rs.mocked(getCitation).mockRejectedValue(new Error("403"));
    fireEvent.click(screen.getByRole("button", { name: "核验并查看引用" }));
    await screen.findByRole("alert");
    expect(screen.queryByText("授权合成正文")).toBeNull();
  });
  it("aborts an in-flight source read when leaving the graph", async () => {
    rs.mocked(getCitation).mockImplementation(
      () => new Promise(() => undefined),
    );
    const rendered = render(
      <LegalGraphViewer
        graph={graph}
        scope={{ tenant_id: "tenant", matter_id: "matter" }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /签约 事件/ }));
    fireEvent.click(screen.getByRole("button", { name: "核验并查看引用" }));
    await waitFor(() => expect(getCitation).toHaveBeenCalled());
    const signal = rs.mocked(getCitation).mock.calls.at(-1)?.[5];
    rendered.unmount();
    expect(signal?.aborted).toBe(true);
  });
  it.each([
    ["available", "来源可用"],
    ["archived", "原材料已归档"],
    ["legal_hold", "原材料保全中"],
    ["purge_pending", "原材料待清除"],
    ["purge_failed", "原材料清除失败"],
    ["purged", "原材料已清除"],
  ])(
    "distinguishes %s while preserving authorized historical quotes",
    async (state, label) => {
      rs.mocked(getCitation).mockResolvedValue({
        quote_text: "合成历史引用",
        physical_page_number: 1,
        source_state: state,
        ocr_result_state: "superseded",
      } as Awaited<ReturnType<typeof getCitation>>);
      render(
        <LegalGraphViewer
          graph={graph}
          scope={{ tenant_id: "tenant", matter_id: "matter" }}
        />,
      );
      fireEvent.click(screen.getByRole("button", { name: /签约 事件/ }));
      fireEvent.click(screen.getByRole("button", { name: "核验并查看引用" }));
      await screen.findByText("合成历史引用");
      expect(screen.getByRole("status").textContent).toContain(label);
      expect(screen.getByRole("status").textContent).toContain("历史 OCR 版本");
      expect(screen.getByText(/不会随 OCR 重跑改写/)).toBeDefined();
    },
  );
});

it("automatically opens the AI topic and layout, then restores complete data and AI defaults", async () => {
  const data: LegalGraph = {
    ...graph,
    presentation: {
      summary: "按本案争议事件编排，其他关系保留在全图",
      default_view_id: "topic",
      groups: [
        { id: "events", label: "争议事件", color: "#2563eb", node_ids: ["e"] },
      ],
      views: [
        {
          id: "topic",
          label: "本案待核查事件",
          description: "只看事件，其他关系请查看全图",
          layout: "analysis",
          node_ids: ["e"],
          edge_ids: [],
        },
      ],
    },
  };
  const onChange = rs.fn();
  render(<LegalGraphViewer graph={data} onChange={onChange} />);
  expect(screen.getByLabelText<HTMLSelectElement>("AI 编排主题").value).toBe(
    "topic",
  );
  expect(screen.getByLabelText<HTMLSelectElement>("图谱布局方式").value).toBe(
    "analysis",
  );
  expect(screen.getByText(/当前 1 个节点 \/ 0 条关系/)).toBeTruthy();
  expect(screen.queryByRole("button", { name: /甲方/ })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "查看完整图谱" }));
  expect(screen.getByText(/当前 2 个节点 \/ 1 条关系/)).toBeTruthy();
  fireEvent.change(screen.getByLabelText("搜索图谱节点或关系"), {
    target: { value: "does-not-exist" },
  });
  fireEvent.click(screen.getByRole("button", { name: "恢复 AI 编排" }));
  expect(
    screen.getByLabelText<HTMLInputElement>("搜索图谱节点或关系").value,
  ).toBe("");
  expect(screen.getByLabelText<HTMLSelectElement>("AI 编排主题").value).toBe(
    "topic",
  );
  expect(screen.getByText(/当前 1 个节点 \/ 0 条关系/)).toBeTruthy();
  expect(onChange).not.toHaveBeenCalled();
});
