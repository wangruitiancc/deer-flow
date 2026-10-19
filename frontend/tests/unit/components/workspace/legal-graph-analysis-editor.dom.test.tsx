import { afterEach, beforeEach, expect, it, rs } from "@rstest/core";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";

rs.mock("@/core/law", () => ({ getMatter: rs.fn() }));

import { LegalGraphAnalysisEditor } from "@/components/workspace/law/legal-graph-analysis-editor";
import { getMatter, type Matter } from "@/core/law";
import { type LegalGraph } from "@/core/law/legal-graph";

const scope = { tenant_id: "tenant", matter_id: "matter" };
const matter: Matter = {
  id: "matter",
  tenant_id: "tenant",
  title: "合成案件",
  cause: "候选案由",
  stage: "intake",
  version: 1,
  status: "active",
  kind: "case",
  case_number: null,
  classification: "normal",
  created_by_membership_id: "member",
  created_at: "2026-10-16T00:00:00Z",
  updated_at: "2026-10-16T00:00:00Z",
};
const graph: LegalGraph = {
  format: "matrix-law.legal-graph",
  schema_version: 1,
  title: "合成图谱",
  nodes: [
    {
      id: "issue",
      type: "other",
      role: "issue",
      label: "待核对争点",
      category: "legal",
      source_ids: [],
    },
    {
      id: "element",
      type: "other",
      role: "element",
      label: "待核对条件",
      category: "legal",
      source_ids: [],
    },
  ],
  edges: [
    {
      id: "relation",
      source: "issue",
      target: "element",
      label: "需要核对",
      category: "legal",
      source_ids: [],
      confidence: "INFERRED",
      legal: {
        family: "issues",
        kind: "requires",
        statement: "analysis_hypothesis",
        issue_ids: ["issue"],
        framework_ids: ["frame"],
        questions: [],
      },
    },
  ],
  sources: [],
  analysis: {
    registered_cause: "候选案由",
    matter_version: 1,
    case_labels: ["候选案由"],
    notes: ["合成验收，规范待核验"],
    element_node_ids: ["element"],
    framework_source_ids: [],
    frameworks: [
      {
        id: "frame",
        label: "本案分析路径",
        case_label: "候选案由",
        element_node_ids: ["element"],
        issue_node_ids: ["issue"],
        source_ids: [],
      },
    ],
  },
};
beforeEach(() => {
  rs.clearAllMocks();
  rs.mocked(getMatter).mockResolvedValue(matter);
});
afterEach(() => {
  cleanup();
  rs.restoreAllMocks();
});
async function loaded() {
  await waitFor(() =>
    expect(screen.getByText(/当前案件：合成案件/)).toBeDefined(),
  );
}
function confirm() {
  fireEvent.click(
    screen.getByRole("checkbox", {
      name: "已对照本案详情核对本轮候选框架及适用范围",
    }),
  );
}

it("edits framework memberships atomically in the draft and preserves facts, citations and stable IDs", async () => {
  const changed = rs.fn();
  render(
    <LegalGraphAnalysisEditor
      graph={graph}
      scope={scope}
      onChange={changed}
      onClose={rs.fn()}
    />,
  );
  await loaded();
  fireEvent.change(screen.getByLabelText("框架名称 1"), {
    target: { value: "修订分析路径" },
  });
  expect(changed).not.toHaveBeenCalled();
  confirm();
  fireEvent.click(screen.getByRole("button", { name: "应用分析框架到草稿" }));
  await waitFor(() => expect(changed).toHaveBeenCalledTimes(1));
  const next = changed.mock.calls[0]![0] as LegalGraph;
  expect(next.analysis?.frameworks?.[0]?.label).toBe("修订分析路径");
  expect(next.analysis?.frameworks?.[0]?.id).toBe("frame");
  expect(next.nodes).toEqual(graph.nodes);
  expect(next.sources).toEqual(graph.sources);
  expect(graph.analysis?.frameworks?.[0]?.label).toBe("本案分析路径");
  expect(getMatter).toHaveBeenCalledTimes(2);
});

it("rejects a changed matter baseline at apply, retaining edits until the new case metadata is checked", async () => {
  const newer = { ...matter, version: 2, cause: "变更后的登记案由" };
  rs.mocked(getMatter).mockResolvedValueOnce(matter).mockResolvedValue(newer);
  const changed = rs.fn();
  render(
    <LegalGraphAnalysisEditor
      graph={graph}
      scope={scope}
      onChange={changed}
      onClose={rs.fn()}
    />,
  );
  await loaded();
  confirm();
  fireEvent.click(screen.getByRole("button", { name: "应用分析框架到草稿" }));
  await waitFor(() =>
    expect(screen.getByRole("alert").textContent).toContain(
      "案件信息又发生变化",
    ),
  );
  expect(changed).not.toHaveBeenCalled();
  expect(screen.getByRole<HTMLInputElement>("checkbox").checked).toBe(false);
  confirm();
  fireEvent.click(screen.getByRole("button", { name: "应用分析框架到草稿" }));
  await waitFor(() => expect(changed).toHaveBeenCalledTimes(1));
  expect(
    (changed.mock.calls[0]![0] as LegalGraph).analysis?.registered_cause,
  ).toBe(newer.cause);
  expect(
    (changed.mock.calls[0]![0] as LegalGraph).analysis?.matter_version,
  ).toBe(2);
});

it("removes only the selected framework and its edge memberships", async () => {
  const changed = rs.fn();
  render(
    <LegalGraphAnalysisEditor
      graph={graph}
      scope={scope}
      onChange={changed}
      onClose={rs.fn()}
    />,
  );
  await loaded();
  fireEvent.click(screen.getByRole("button", { name: "移除此框架" }));
  confirm();
  fireEvent.click(screen.getByRole("button", { name: "应用分析框架到草稿" }));
  await waitFor(() => expect(changed).toHaveBeenCalledTimes(1));
  const next = changed.mock.calls[0]![0] as LegalGraph;
  expect(next.analysis?.frameworks).toEqual([]);
  expect(next.edges[0]?.legal?.framework_ids).toEqual([]);
  expect(next.edges[0]?.label).toBe(graph.edges[0]?.label);
  expect(next.nodes).toEqual(graph.nodes);
});

it("never applies late metadata after unmount and aborts the protected request", async () => {
  let resolve!: (value: Matter) => void;
  rs.mocked(getMatter).mockReturnValue(
    new Promise((done) => {
      resolve = done;
    }),
  );
  const changed = rs.fn();
  const view = render(
    <LegalGraphAnalysisEditor
      graph={graph}
      scope={scope}
      onChange={changed}
      onClose={rs.fn()}
    />,
  );
  const signal = rs.mocked(getMatter).mock.calls[0]![2]!;
  view.unmount();
  expect(signal.aborted).toBe(true);
  await act(async () => {
    resolve(matter);
  });
  expect(changed).not.toHaveBeenCalled();
});

it("blocks stale graph scope and does not apply after an authorization failure", async () => {
  const changed = rs.fn();
  const view = render(
    <LegalGraphAnalysisEditor
      graph={graph}
      scope={scope}
      onChange={changed}
      onClose={rs.fn()}
    />,
  );
  await loaded();
  view.rerender(
    <LegalGraphAnalysisEditor
      graph={graph}
      scope={{ ...scope, matter_id: "other" }}
      onChange={changed}
      onClose={rs.fn()}
    />,
  );
  expect(
    screen
      .getByRole("button", {
        name: "应用分析框架到草稿",
      })
      .hasAttribute("disabled"),
  ).toBe(true);
  expect(screen.queryByText(/当前案件：/)).toBeNull();
  expect(changed).not.toHaveBeenCalled();
});

it("clears the current baseline after a denied refresh and blocks further application", async () => {
  const changed = rs.fn();
  render(
    <LegalGraphAnalysisEditor
      graph={graph}
      scope={scope}
      onChange={changed}
      onClose={rs.fn()}
    />,
  );
  await loaded();
  confirm();
  rs.mocked(getMatter).mockRejectedValue(new Error("权限已撤销"));
  fireEvent.click(screen.getByRole("button", { name: "重新读取案件信息" }));
  await waitFor(() =>
    expect(screen.getByRole("alert").textContent).toContain("权限已撤销"),
  );
  expect(screen.queryByText(/当前案件：/)).toBeNull();
  expect(
    screen
      .getByRole("button", {
        name: "应用分析框架到草稿",
      })
      .hasAttribute("disabled"),
  ).toBe(true);
});

it("clears case metadata if authorization is lost during apply and keeps the draft unchanged", async () => {
  const changed = rs.fn();
  render(
    <LegalGraphAnalysisEditor
      graph={graph}
      scope={scope}
      onChange={changed}
      onClose={rs.fn()}
    />,
  );
  await loaded();
  confirm();
  rs.mocked(getMatter).mockRejectedValue(new Error("权限已撤销"));
  fireEvent.click(screen.getByRole("button", { name: "应用分析框架到草稿" }));
  await waitFor(() =>
    expect(screen.getByRole("alert").textContent).toContain("权限已撤销"),
  );
  expect(screen.queryByText(/当前案件：/)).toBeNull();
  expect(
    screen
      .getByRole("button", { name: "应用分析框架到草稿" })
      .hasAttribute("disabled"),
  ).toBe(true);
  expect(changed).not.toHaveBeenCalled();
});
