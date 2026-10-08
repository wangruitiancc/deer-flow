import { describe, expect, it } from "@rstest/core";

import {
  pathOfLawProject,
  pathOfNewLawProject,
  toggleExpandedProject,
  visibleLawProjects,
} from "@/core/law/project-tree";
import type { Matter } from "@/core/law/types";

function matter(overrides: Partial<Matter> = {}): Matter {
  return {
    id: "matter-1",
    tenant_id: "tenant-1",
    kind: "case",
    case_number: "（2026）吉01民初100号",
    title: "劳动争议案件",
    cause: "违法解除劳动合同",
    stage: "analysis",
    status: "active",
    classification: "normal",
    created_by_membership_id: "membership-1",
    version: 1,
    created_at: "2026-09-01T00:00:00Z",
    updated_at: "2026-09-05T00:00:00Z",
    ...overrides,
  };
}

describe("legal project tree model", () => {
  it("builds stable project and creation links without losing legal scope", () => {
    expect(pathOfLawProject("tenant/a", "matter b")).toBe(
      "/workspace/law?tenant=tenant%2Fa&matter=matter+b",
    );
    expect(pathOfNewLawProject("tenant/a")).toBe(
      "/workspace/law?new=project&tenant=tenant%2Fa",
    );
  });

  it("hides archived projects and orders visible projects by activity", () => {
    const projects = visibleLawProjects(
      [
        matter({ id: "older", updated_at: "2026-09-01T00:00:00Z" }),
        matter({ id: "archived", status: "archived" }),
        matter({ id: "newer", updated_at: "2026-09-06T00:00:00Z" }),
      ],
      "",
    );

    expect(projects.map((project) => project.id)).toEqual(["newer", "older"]);
  });

  it("searches legal title, case number, background, and work kind", () => {
    const projects = [
      matter(),
      matter({
        id: "contract",
        kind: "contract_review",
        case_number: null,
        title: "采购框架协议",
        cause: "供应商付款条款审核",
      }),
    ];

    expect(visibleLawProjects(projects, "吉01")).toHaveLength(1);
    expect(visibleLawProjects(projects, "付款")[0]?.id).toBe("contract");
    expect(visibleLawProjects(projects, "contract_review")[0]?.id).toBe(
      "contract",
    );
  });

  it("toggles one project without mutating the previous expansion set", () => {
    const current = new Set(["matter-1"]);
    const collapsed = toggleExpandedProject(current, "matter-1");
    const expanded = toggleExpandedProject(collapsed, "matter-2");

    expect(current.has("matter-1")).toBe(true);
    expect(collapsed.has("matter-1")).toBe(false);
    expect(expanded.has("matter-2")).toBe(true);
  });
});
