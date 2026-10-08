import { describe, expect, it } from "@rstest/core";

import { loadTranslations } from "@/core/i18n/translations";

describe("core copy loading", () => {
  it("loads only the requested overseas and domestic copy", async () => {
    const [english, chinese] = await Promise.all([
      loadTranslations("en-US"),
      loadTranslations("zh-CN"),
    ]);
    expect(english.inputBox.disclaimer).toBe(
      "AI output is for legal-work assistance and requires authorized professional review",
    );
    expect(chinese.inputBox.disclaimer).toBe(
      "AI 输出仅供法律工作参考，须由授权专业人员复核",
    );
    expect(english.channels.descriptions.buzz).toBe(
      "Buzz channels and direct messages through your Matrix-Law agent.",
    );
    expect(chinese.channels.descriptions.buzz).toBe(
      "通过 Matrix-Law 智能体接收 Buzz 频道消息和私聊。",
    );
  });
});
