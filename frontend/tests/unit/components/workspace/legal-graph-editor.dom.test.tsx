import { afterEach, describe, expect, it, rs } from "@rstest/core";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { LegalGraphEditor } from "@/components/workspace/law/legal-graph-editor";
import { type LegalGraph } from "@/core/law/legal-graph";

const graph: LegalGraph = {
  format: "matrix-law.legal-graph",
  schema_version: 1,
  title: "合成图谱",
  nodes: [
    {
      id: "e",
      label: "签约",
      type: "event",
      category: "timeline",
      date: { value: "2024-02", origin: "material" },
      source_ids: ["s"],
    },
  ],
  edges: [],
  sources: [{ id: "s", kind: "unverified", quote: "合成摘录" }],
};
afterEach(() => {
  cleanup();
  rs.restoreAllMocks();
});
describe("legal graph edit dialog", () => {
  it("keeps changes local until apply and marks a changed date as user supplied", () => {
    const changed = rs.fn(),
      closed = rs.fn();
    render(
      <LegalGraphEditor
        graph={graph}
        target={{ kind: "node", value: graph.nodes[0]! }}
        onChange={changed}
        onClose={closed}
      />,
    );
    fireEvent.change(screen.getByLabelText("节点名称"), {
      target: { value: "更正签约" },
    });
    fireEvent.change(screen.getByLabelText("事件日期（可留空）"), {
      target: { value: "2024" },
    });
    expect(changed).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "应用到草稿" }));
    const next = changed.mock.calls[0]![0] as LegalGraph;
    expect(next.nodes[0]?.date).toEqual({ value: "2024", origin: "user" });
    expect(next.nodes[0]?.source_ids).toEqual(["s"]);
    expect(closed).toHaveBeenCalledTimes(1);
    expect(graph.nodes[0]?.label).toBe("签约");
  });
  it("keeps invalid dates in the form, then permits correction", () => {
    const changed = rs.fn();
    render(
      <LegalGraphEditor
        graph={graph}
        target={{ kind: "node", value: graph.nodes[0]! }}
        onChange={changed}
        onClose={rs.fn()}
      />,
    );
    fireEvent.change(screen.getByLabelText("事件日期（可留空）"), {
      target: { value: "2023-02-29" },
    });
    fireEvent.click(screen.getByRole("button", { name: "应用到草稿" }));
    expect(screen.getByRole("alert")).toBeDefined();
    expect(changed).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("事件日期（可留空）"), {
      target: { value: "2024-02-29" },
    });
    fireEvent.click(screen.getByRole("button", { name: "应用到草稿" }));
    expect(changed).toHaveBeenCalledTimes(1);
  });
  it("requires confirmation to abandon changed fields", () => {
    const changed = rs.fn(),
      closed = rs.fn();
    const confirm = rs.spyOn(window, "confirm").mockReturnValue(false);
    render(
      <LegalGraphEditor
        graph={graph}
        target={{ kind: "title" }}
        onChange={changed}
        onClose={closed}
      />,
    );
    fireEvent.change(screen.getByLabelText("图谱名称"), {
      target: { value: "新名称" },
    });
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(closed).not.toHaveBeenCalled();
    confirm.mockReturnValue(true);
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(closed).toHaveBeenCalledTimes(1);
    expect(changed).not.toHaveBeenCalled();
  });
  it("refuses to overwrite an externally refreshed graph or edit after the callback is revoked", () => {
    const changed = rs.fn();
    const props = {
      graph,
      target: { kind: "title" as const },
      onChange: changed,
      onClose: rs.fn(),
    };
    const mounted = render(<LegalGraphEditor {...props} />);
    fireEvent.change(screen.getByLabelText("图谱名称"), {
      target: { value: "本地修改" },
    });
    mounted.rerender(
      <LegalGraphEditor {...props} graph={{ ...graph, title: "外部修改" }} />,
    );
    expect(
      screen
        .getByRole("button", { name: "应用到草稿" })
        .hasAttribute("disabled"),
    ).toBe(true);
    expect(screen.getByText(/图谱已变化/)).toBeDefined();
    mounted.rerender(<LegalGraphEditor {...props} onChange={undefined} />);
    expect(
      screen
        .getByRole("button", { name: "应用到草稿" })
        .hasAttribute("disabled"),
    ).toBe(true);
    expect(changed).not.toHaveBeenCalled();
  });
});
