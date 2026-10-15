import { describe, expect, it } from "@rstest/core";

import {
  initialWorkspaceTabs,
  workspaceFunctionForResource,
  workspaceTabsReducer,
} from "@/core/law/workspace-tabs";

describe("legal workspace view lifecycle", () => {
  it("closes every view without discarding visited work, then reopens one copy", () => {
    let state = workspaceTabsReducer(initialWorkspaceTabs, {
      type: "open",
      id: "speech",
    });
    for (const id of [...state.opened])
      state = workspaceTabsReducer(state, { type: "close", id });
    expect(state.active).toBeNull();
    expect(state.visited).toEqual(["documents", "speech"]);
    state = workspaceTabsReducer(state, { type: "open", id: "speech" });
    state = workspaceTabsReducer(state, { type: "open", id: "speech" });
    expect(state.opened).toEqual(["speech"]);
  });

  it("selects a neighbor on active close without moving another active view", () => {
    let state = workspaceTabsReducer(initialWorkspaceTabs, {
      type: "open",
      id: "speech",
    });
    state = workspaceTabsReducer(state, { type: "close", id: "speech" });
    expect(state.active).toBe("graph");
    state = workspaceTabsReducer(state, { type: "close", id: "documents" });
    expect(state.active).toBe("graph");
  });

  it("routes native and saved graphs to the graph workspace, evidence to proofreading", () => {
    expect(
      workspaceFunctionForResource({
        kind: "file",
        path: "/outputs/案情.law-graph.json",
      }),
    ).toBe("graph");
    expect(
      workspaceFunctionForResource({
        kind: "saved",
        artifactKind: "knowledge_graph",
      }),
    ).toBe("graph");
    expect(workspaceFunctionForResource({ kind: "evidence" })).toBe(
      "documents",
    );
    expect(
      workspaceFunctionForResource({
        kind: "file",
        path: "/outputs/答辩状.md",
      }),
    ).toBe("drafting");
  });
});
