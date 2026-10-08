import { afterEach, describe, expect, it, rs } from "@rstest/core";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";

import {
  LegalAuthoritiesEditor,
  type AuthorityEditorTarget,
} from "@/components/workspace/law/legal-authorities-editor";
import { type LegalAuthorities } from "@/core/law/legal-authorities";
import { convertLegacyLawRefs } from "@/core/law/legal-authorities-import";

import fixture from "../../../fixtures/legal-authorities.json";

const document = fixture as LegalAuthorities;
const onChange = rs.fn();
const onClose = rs.fn();
afterEach(() => {
  cleanup();
  rs.restoreAllMocks();
  rs.clearAllMocks();
});
function confirm() {
  fireEvent.click(screen.getByRole("checkbox"));
}
function apply() {
  confirm();
  fireEvent.click(screen.getByRole("button", { name: "应用到草稿" }));
}
describe("legal authorities structured editing forms", () => {
  it("edits metadata of a bodyless legacy ref without making body required or rewriting provenance", async () => {
    const { authorities } = await convertLegacyLawRefs(
      new TextEncoder().encode(
        JSON.stringify([
          {
            code: "仅引用示例法",
            article: "第七条",
            origin: "mining",
            addedAt: "旧值",
            text: "",
          },
        ]),
      ),
      { title: "旧记录", question: "待核验" },
    );
    render(
      <LegalAuthoritiesEditor
        document={authorities}
        target={{ kind: "entry", id: authorities.entries[0]!.id }}
        onChange={onChange}
        onClose={onClose}
      />,
    );
    expect(
      screen.getByLabelText<HTMLTextAreaElement>("条文或摘要内容").required,
    ).toBe(false);
    fireEvent.change(screen.getByLabelText("收录理由"), {
      target: { value: "保留引用等待核验" },
    });
    apply();
    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
    expect(onChange.mock.calls[0]![0].entries[0].text).toBeNull();
    expect(onChange.mock.calls[0]![0].entries[0].legacy_origin).toEqual(
      authorities.entries[0]!.legacy_origin,
    );
  });
  it("creates a manual entry only after confirmation and applies locally", async () => {
    render(
      <LegalAuthoritiesEditor
        document={document}
        target={{ kind: "manual" }}
        onChange={onChange}
        onClose={onClose}
      />,
    );
    expect(
      screen
        .getByRole("button", { name: "应用到草稿" })
        .hasAttribute("disabled"),
    ).toBe(true);
    fireEvent.change(screen.getByLabelText("法律名称"), {
      target: { value: "手工合成法律" },
    });
    fireEvent.change(screen.getByLabelText("条文或摘要内容"), {
      target: { value: "手工测试正文" },
    });
    fireEvent.change(screen.getByLabelText("出处说明（可留空）"), {
      target: { value: "测试说明" },
    });
    expect(onChange).not.toHaveBeenCalled();
    apply();
    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
    expect(onChange.mock.calls[0]![0].entries.at(-1)).toMatchObject({
      law_name: "手工合成法律",
      origin: "manual",
      text: "手工测试正文",
      review_status: "unreviewed",
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
  it("collects explicit source text without changing the existing source", async () => {
    render(
      <LegalAuthoritiesEditor
        document={document}
        target={{ kind: "collect" }}
        onChange={onChange}
        onClose={onClose}
      />,
    );
    fireEvent.change(screen.getByLabelText("选择已记录来源"), {
      target: { value: "legacy-1" },
    });
    fireEvent.click(screen.getByRole("button", { name: "使用来源文字" }));
    expect(
      screen.getByLabelText<HTMLTextAreaElement>("条文或摘要内容").value,
    ).toBe(fixture.sources[0]!.text);
    fireEvent.change(screen.getByLabelText("法律名称"), {
      target: { value: "旧目录示例" },
    });
    apply();
    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
    const next = onChange.mock.calls[0]![0] as LegalAuthorities;
    expect(next.sources).toEqual(document.sources);
    expect(next.entries.at(-1)).toMatchObject({
      origin: "favorite",
      source_ids: ["legacy-1"],
      text_kind: "legacy_excerpt",
    });
  });
  it("requires a fresh date basis after editing the date and resets confirmation", async () => {
    render(
      <LegalAuthoritiesEditor
        document={document}
        target={{ kind: "entry", id: "entry-1" }}
        onChange={onChange}
        onClose={onClose}
      />,
    );
    fireEvent.click(screen.getByText("日期与时点（缺失请留空，不默认今天）"));
    confirm();
    fireEvent.change(screen.getByLabelText("公布日期（年 / 年月 / 年月日）"), {
      target: { value: "2025" },
    });
    expect(
      screen.getByLabelText<HTMLTextAreaElement>("公布日期的依据").value,
    ).toBe("");
    expect(screen.getByRole<HTMLInputElement>("checkbox").checked).toBe(false);
    apply();
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain(
        "公布日期须同时填写日期与依据",
      ),
    );
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("公布日期的依据"), {
      target: { value: "人工复核后的年份" },
    });
    apply();
    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
    expect(onChange.mock.calls[0]![0].entries[0].published_date).toEqual({
      value: "2025",
      basis: "人工复核后的年份",
    });
  });
  it.each(["remove", "restore"] as const)(
    "makes %s explicit and preserves the prior document",
    async (kind) => {
      render(
        <LegalAuthoritiesEditor
          document={document}
          target={{ kind, id: kind === "remove" ? "entry-1" : "entry-2" }}
          onChange={onChange}
          onClose={onClose}
        />,
      );
      if (kind === "remove")
        fireEvent.change(screen.getByLabelText("移除原因"), {
          target: { value: "与咨询不相关" },
        });
      else expect(screen.getByText(/若需保留这次移除记录/)).toBeDefined();
      apply();
      await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
      const next = onChange.mock.calls[0]![0] as LegalAuthorities;
      expect(next.entries).toHaveLength(2);
      expect(next.entries[kind === "remove" ? 0 : 1]!.state).toBe(
        kind === "remove" ? "removed" : "active",
      );
      expect(document.entries[1]!.removal_reason).toBe(
        fixture.entries[1]!.removal_reason,
      );
    },
  );
  it("does not discard a dirty form without confirmation", () => {
    rs.spyOn(window, "confirm").mockReturnValue(false);
    render(
      <LegalAuthoritiesEditor
        document={document}
        target={{ kind: "document" }}
        onChange={onChange}
        onClose={onClose}
      />,
    );
    fireEvent.change(screen.getByLabelText("研究问题"), {
      target: { value: "新问题" },
    });
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(onClose).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
  });
  it.each(["changed-file", "readonly", "changed-target", "unmount", "cancel"])(
    "ignores late validation when %s",
    async (mode) => {
      const hash = await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(fixture.sources[0]!.text),
      );
      let resolve!: (value: ArrayBuffer) => void;
      rs.spyOn(crypto.subtle, "digest").mockReturnValue(
        new Promise<ArrayBuffer>((done) => {
          resolve = done;
        }),
      );
      const target: AuthorityEditorTarget = { kind: "document" };
      const view = render(
        <LegalAuthoritiesEditor
          document={document}
          target={target}
          onChange={onChange}
          onClose={onClose}
        />,
      );
      fireEvent.change(screen.getByLabelText("研究问题"), {
        target: { value: "新问题" },
      });
      apply();
      await screen.findByText("正在检查草稿…");
      if (mode === "unmount") view.unmount();
      else if (mode === "cancel") {
        rs.spyOn(window, "confirm").mockReturnValue(true);
        fireEvent.click(screen.getByRole("button", { name: "取消" }));
      } else
        view.rerender(
          <LegalAuthoritiesEditor
            document={mode === "changed-file" ? { ...document } : document}
            target={
              mode === "changed-target"
                ? { kind: "entry", id: "entry-1" }
                : target
            }
            onChange={mode === "readonly" ? undefined : onChange}
            onClose={onClose}
          />,
        );
      await act(async () => {
        resolve(hash);
      });
      expect(onChange).not.toHaveBeenCalled();
    },
  );
});
