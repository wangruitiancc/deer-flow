import { afterEach, beforeEach, describe, expect, it, rs } from "@rstest/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";

rs.mock("@/core/law", () => ({
  useLawThreadContext: rs.fn(),
  useLawProjectArtifactVersions: rs.fn(() => ({ data: undefined })),
  useLawMatter: () => ({ data: { title: "测试法律项目" }, isError: false }),
  listProjectArtifacts: rs.fn(),
  saveProjectArtifact: rs.fn(),
}));
rs.mock("@/core/law/templates", { spy: true });
rs.mock("@/core/law/artifact-source", () => ({
  isFormalProjectArtifact: (path: string) =>
    path.startsWith("/mnt/user-data/outputs/"),
  loadProjectArtifactSource: rs.fn(),
}));
rs.mock("sonner", () => ({ toast: { success: rs.fn() } }));

import { SaveProjectArtifact } from "@/components/workspace/law/save-project-artifact";
import {
  listProjectArtifacts,
  saveProjectArtifact,
  useLawThreadContext,
  useLawProjectArtifactVersions,
} from "@/core/law";
import { loadProjectArtifactSource } from "@/core/law/artifact-source";
import { loadLegalTemplateCatalog } from "@/core/law/templates";

import authorities from "../../../fixtures/legal-authorities.json";

const scope = {
  tenant_id: "tenant",
  matter_id: "matter",
  matter_role: "lawyer",
};
const fresh = rs.fn();
const clients: QueryClient[] = [];
function mount(
  blockedReason?: string,
  filepath = "/mnt/user-data/outputs/note.md",
) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  clients.push(client);
  return render(
    <QueryClientProvider client={client}>
      <SaveProjectArtifact
        threadId="thread"
        filepath={filepath}
        blockedReason={blockedReason}
      />
    </QueryClientProvider>,
  );
}
beforeEach(() => {
  rs.mocked(useLawThreadContext).mockReturnValue({
    data: scope,
    refetch: fresh,
    isError: false,
  } as unknown as ReturnType<typeof useLawThreadContext>);
  fresh.mockResolvedValue({ data: scope, isError: false });
  rs.mocked(listProjectArtifacts).mockResolvedValue([]);
  rs.mocked(useLawProjectArtifactVersions).mockReturnValue({
    data: undefined,
  } as never);
  rs.mocked(loadLegalTemplateCatalog).mockResolvedValue({
    schema_version: 1,
    available: true,
    skill_name: "matrix-law-templates",
    templates: [],
  });
  rs.mocked(loadProjectArtifactSource).mockResolvedValue({
    file: new File(["draft"], "note.md"),
    sha256: "a".repeat(64),
  });
});
afterEach(() => {
  cleanup();
  clients.splice(0).forEach((client) => client.clear());
  rs.clearAllMocks();
});

describe("project artifact save dialog", () => {
  it.each(["valid", "digest", "kind", "bom", "suffix"])(
    "checks structured legal authorities before project save: %s",
    async (mode) => {
      const filename = "consultation.law-authorities.json";
      const payload = structuredClone(authorities);
      if (mode === "digest") payload.sources[0]!.text_sha256 = "a".repeat(64);
      const file = new File(
        [(mode === "bom" ? "\ufeff" : "") + JSON.stringify(payload)],
        mode === "suffix" ? "renamed.json" : filename,
      );
      rs.mocked(loadProjectArtifactSource).mockResolvedValue({
        file,
        sha256: "a".repeat(64),
      });
      rs.mocked(saveProjectArtifact).mockResolvedValue({
        artifact_version: { version_number: 1 },
      } as Awaited<ReturnType<typeof saveProjectArtifact>>);
      mount(undefined, `/mnt/user-data/outputs/${filename}`);
      fireEvent.click(screen.getByRole("button", { name: "保存到项目" }));
      await waitFor(() =>
        expect(
          screen
            .getByRole("button", { name: "保存未审核版本" })
            .hasAttribute("disabled"),
        ).toBe(false),
      );
      expect(screen.getByLabelText<HTMLSelectElement>("成果类型").value).toBe(
        "legal_research",
      );
      if (mode === "kind")
        fireEvent.change(screen.getByLabelText("成果类型"), {
          target: { value: "note" },
        });
      fireEvent.click(screen.getByRole("button", { name: "保存未审核版本" }));
      if (mode === "valid") {
        await waitFor(() =>
          expect(saveProjectArtifact).toHaveBeenCalledTimes(1),
        );
        expect(rs.mocked(saveProjectArtifact).mock.calls[0]![0]).toMatchObject({
          file,
          kind: "legal_research",
        });
      } else {
        await screen.findByRole("alert");
        expect(saveProjectArtifact).not.toHaveBeenCalled();
      }
    },
  );
  it("does not permit promotion while the editor has unsaved changes", () => {
    mount("请先保存当前编辑内容，再保存到项目。");
    expect(
      screen
        .getByRole("button", { name: "保存到项目" })
        .hasAttribute("disabled"),
    ).toBe(true);
    expect(listProjectArtifacts).not.toHaveBeenCalled();
  });

  it("loads authorized destinations and saves a note with explicit unreviewed wording", async () => {
    rs.mocked(saveProjectArtifact).mockResolvedValue({
      artifact_version: { version_number: 1 },
    } as Awaited<ReturnType<typeof saveProjectArtifact>>);
    mount();
    fireEvent.click(screen.getByRole("button", { name: "保存到项目" }));
    await waitFor(() =>
      expect(
        screen
          .getByRole("button", { name: "保存未审核版本" })
          .hasAttribute("disabled"),
      ).toBe(false),
    );
    fireEvent.change(screen.getByLabelText("成果类型"), {
      target: { value: "note" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存未审核版本" }));
    await waitFor(() => expect(saveProjectArtifact).toHaveBeenCalledTimes(1));
    expect(rs.mocked(saveProjectArtifact).mock.calls[0]![0]).toMatchObject({
      tenantId: "tenant",
      matterId: "matter",
      kind: "note",
      threadId: "thread",
    });
    expect(fresh).toHaveBeenCalledTimes(1);
  });

  it("saves exact selected strategy and built-in template versions with a Markdown work product", async () => {
    const strategy = {
      id: "strategy-artifact",
      title: "诉讼策略",
      kind: "litigation_strategy",
      status: "active",
      version: 2,
      current_version_number: 2,
    };
    rs.mocked(listProjectArtifacts).mockResolvedValue([strategy] as never);
    rs.mocked(useLawProjectArtifactVersions).mockReturnValue({
      data: [
        {
          id: "strategy-version-2",
          version_number: 2,
          review_status: "unreviewed",
        },
      ],
    } as never);
    rs.mocked(loadLegalTemplateCatalog).mockResolvedValue({
      schema_version: 1,
      available: true,
      skill_name: "matrix-law-templates",
      templates: [
        {
          id: "civil-complaint",
          title: "民事起诉状",
          artifact_kind: "document",
          source_sha256: "b".repeat(64),
        },
      ],
    });
    rs.mocked(saveProjectArtifact).mockResolvedValue({
      artifact_version: { version_number: 1 },
    } as Awaited<ReturnType<typeof saveProjectArtifact>>);

    mount();
    fireEvent.click(screen.getByRole("button", { name: "保存到项目" }));
    await waitFor(() =>
      expect(screen.getByLabelText("诉讼策略版本")).toBeTruthy(),
    );
    fireEvent.change(screen.getByLabelText("诉讼策略版本"), {
      target: { value: "strategy-version-2" },
    });
    fireEvent.change(screen.getByLabelText("内置模板版本"), {
      target: { value: "civil-complaint" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存未审核版本" }));
    await waitFor(() => expect(saveProjectArtifact).toHaveBeenCalledTimes(1));
    expect(rs.mocked(saveProjectArtifact).mock.calls[0]![0]).toMatchObject({
      kind: "document",
      derivedFromVersionId: "strategy-version-2",
      templateId: "civil-complaint",
      templateSha256: "b".repeat(64),
    });
  });

  it("announces a failure and reuses the same idempotency key on explicit retry", async () => {
    rs.mocked(saveProjectArtifact).mockRejectedValue(
      new Error("保存结果未确认"),
    );
    mount();
    fireEvent.click(screen.getByRole("button", { name: "保存到项目" }));
    await waitFor(() =>
      expect(
        screen
          .getByRole("button", { name: "保存未审核版本" })
          .hasAttribute("disabled"),
      ).toBe(false),
    );
    fireEvent.click(screen.getByRole("button", { name: "保存未审核版本" }));
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain("保存结果未确认"),
    );
    fireEvent.click(screen.getByRole("button", { name: "保存未审核版本" }));
    await waitFor(() => expect(saveProjectArtifact).toHaveBeenCalledTimes(2));
    const calls = rs.mocked(saveProjectArtifact).mock.calls;
    expect(calls[0]![0].idempotencyKey).toBe(calls[1]![0].idempotencyKey);
  });

  it("refuses a changed project context before downloading or saving", async () => {
    fresh.mockResolvedValue({
      data: { ...scope, matter_id: "changed" },
      isError: false,
    });
    mount();
    fireEvent.click(screen.getByRole("button", { name: "保存到项目" }));
    await waitFor(() =>
      expect(
        screen
          .getByRole("button", { name: "保存未审核版本" })
          .hasAttribute("disabled"),
      ).toBe(false),
    );
    fireEvent.click(screen.getByRole("button", { name: "保存未审核版本" }));
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain(
        "项目归属或权限已变化",
      ),
    );
    expect(loadProjectArtifactSource).not.toHaveBeenCalled();
    expect(saveProjectArtifact).not.toHaveBeenCalled();
  });
});
