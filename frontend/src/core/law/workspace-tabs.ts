/** View state only. Business drafts and capture controllers outlive a closed tab. */
export const WORKSPACE_FUNCTIONS = [
  { id: "documents", title: "文档校对", description: "案件材料、原件与校对稿" },
  {
    id: "speech",
    title: "录音 / 实时转写",
    description: "录音、文件转写与正式稿",
  },
  { id: "graph", title: "案情图谱", description: "关系、时间线与来源" },
  {
    id: "drafting",
    title: "文书撰写",
    description: "会话文件、成果与版本审核",
  },
  { id: "overview", title: "案件概览", description: "案件信息与工作入口" },
  { id: "deadlines", title: "日程", description: "期限、提醒与确认记录" },
  { id: "authorities", title: "法律依据", description: "法律检索、核验与收藏" },
  { id: "memory", title: "案件记忆", description: "记忆提案与批准记录" },
] as const;

export type WorkspaceFunction = (typeof WORKSPACE_FUNCTIONS)[number]["id"];
export type WorkspaceTabState = {
  opened: WorkspaceFunction[];
  visited: WorkspaceFunction[];
  active: WorkspaceFunction | null;
};
export type WorkspaceTabAction =
  | { type: "open"; id: WorkspaceFunction }
  | { type: "close"; id: WorkspaceFunction };

export const initialWorkspaceTabs: WorkspaceTabState = {
  opened: ["documents", "speech", "graph", "drafting"],
  visited: ["documents"],
  active: "documents",
};

export function workspaceTabsReducer(
  state: WorkspaceTabState,
  action: WorkspaceTabAction,
): WorkspaceTabState {
  if (action.type === "open") {
    return {
      opened: state.opened.includes(action.id)
        ? state.opened
        : [...state.opened, action.id],
      visited: state.visited.includes(action.id)
        ? state.visited
        : [...state.visited, action.id],
      active: action.id,
    };
  }
  const index = state.opened.indexOf(action.id);
  if (index < 0) return state;
  const opened = state.opened.filter((id) => id !== action.id);
  return {
    opened,
    visited: state.visited,
    active:
      state.active === action.id
        ? (opened[Math.min(index, opened.length - 1)] ?? null)
        : state.active,
  };
}

export function workspaceFunctionForResource(resource: {
  kind: "file" | "evidence" | "saved";
  path?: string;
  artifactKind?: string;
}): WorkspaceFunction {
  if (resource.kind === "evidence") return "documents";
  if (
    resource.artifactKind === "knowledge_graph" ||
    resource.path?.toLowerCase().endsWith(".law-graph.json")
  )
    return "graph";
  return "drafting";
}
