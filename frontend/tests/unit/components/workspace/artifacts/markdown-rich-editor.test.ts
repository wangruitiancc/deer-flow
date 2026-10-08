import { describe, expect, it } from "@rstest/core";

import { markdownTableCells } from "@/components/workspace/artifacts/markdown-rich-editor";
import { getVisualMarkdownUnsupportedReason } from "@/core/artifacts/visual-markdown";

describe("visual markdown support", () => {
  it("identifies OCR table cells only when the complete source table is available", () => {
    expect(markdownTableCells("| 项目 | 金额 |\n| --- | --- |\n| 服务费 | 12345元 |"))
      .toEqual(["项目", "金额", "服务费", "12345元"]);
    expect(markdownTableCells("| 项目 | 金额 |\n| 服务费 | 12345元 |")).toBeNull();
    expect(markdownTableCells("| 项目 | 金额 |\n| --- | --- |\n| 服务\\|费 | 12345元 |")).toBeNull();
  });

  it("accepts common legal markdown and citation links", () => {
    expect(
      getVisualMarkdownUnsupportedReason(
        "# 起诉状\n\n| 项目 | 内容 |\n| --- | --- |\n| 原告 | 张某 |\n\n[证据一](citation:ocr/123)",
      ),
    ).toBeNull();
  });

  it.each([
    ["<section>原文</section>", "内嵌 HTML"],
    ["正文[^1]\n\n[^1]: 来源", "脚注"],
    ["::: warning\n注意\n:::", "自定义块"],
    ["$$\nx^2\n$$", "块级公式"],
    ["[法规]: https://example.com\n\n[查看][法规]", "引用式链接定义"],
  ])("fails closed for unsupported syntax", (markdown, reason) => {
    expect(getVisualMarkdownUnsupportedReason(markdown)).toBe(reason);
  });
});
