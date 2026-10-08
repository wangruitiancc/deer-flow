import { beforeEach, expect, it, rs } from "@rstest/core";

rs.mock("@/core/api/fetcher", () => ({ fetch: rs.fn() }));
rs.mock("@/core/config", () => ({ getBackendBaseURL: () => "" }));
rs.mock("@/core/skills/api", () => ({ loadSkills: rs.fn() }));

import { fetch as fetchWithAuth } from "@/core/api/fetcher";
import { loadLegalTemplateCatalog } from "@/core/law/templates";
import { loadSkills } from "@/core/skills/api";

const catalog = {
  schema_version: 1,
  available: true,
  skill_name: "matrix-law-templates",
  templates: [
    {
      id: "meeting-notes",
      title: "会见笔录",
      artifact_kind: "note",
      source_sha256: "a".repeat(64),
    },
  ],
};
beforeEach(() => {
  rs.clearAllMocks();
  rs.mocked(fetchWithAuth).mockResolvedValue(Response.json(catalog));
});
it("reads the authenticated deployment catalog and forwards cancellation", async () => {
  const signal = new AbortController().signal;
  expect(await loadLegalTemplateCatalog(signal)).toEqual(catalog);
  expect(fetchWithAuth).toHaveBeenCalledWith("/api/law/template-catalog", {
    signal,
  });
});
it("does not depend on the general Skill management route hidden by the legal product", async () => {
  rs.mocked(loadSkills).mockRejectedValue(new Error("404"));
  expect(await loadLegalTemplateCatalog()).toEqual(catalog);
  expect(loadSkills).not.toHaveBeenCalled();
});
it("rejects a host without template ports", async () => {
  rs.mocked(fetchWithAuth).mockResolvedValue(
    Response.json({ ...catalog, available: false }),
  );
  await expect(loadLegalTemplateCatalog()).rejects.toThrow(
    /未提供模板创建能力/,
  );
});
it("rejects HTTP failure without exposing response content", async () => {
  rs.mocked(fetchWithAuth).mockResolvedValue(
    new Response("private error", { status: 403 }),
  );
  await expect(loadLegalTemplateCatalog()).rejects.toThrow(
    "无法读取当前部署的法律模板目录。",
  );
});
it("rejects cancellation even if underlying reads have completed", async () => {
  const controller = new AbortController();
  controller.abort();
  await expect(loadLegalTemplateCatalog(controller.signal)).rejects.toThrow();
});
