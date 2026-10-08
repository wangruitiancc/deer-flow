import { describe, expect, it } from "@rstest/core";

import {
  formulaNumberDisagreement,
  formulaOperatorDisagreement,
} from "@/components/workspace/law/formula-opinion-numbers";

describe("formula opinion number cue", () => {
  it("flags a split number instead of treating the second opinion as an automatic correction", () => {
    expect(formulaNumberDisagreement("120 00 × 8% = 26.30", "12000 \\times 8\\%=26.30")).toBe(true);
  });

  it("ignores full-width and thousands formatting while preserving decimal precision", () => {
    expect(formulaNumberDisagreement("金额＝１，２３４．５０元", "\\mathrm{金额}=1234.50\\text{元}")).toBe(false);
    expect(formulaNumberDisagreement("1.20 元", "1.2 \\text{元}")).toBe(true);
  });

  it("does not infer agreement when either result has no readable numbers", () => {
    expect(formulaNumberDisagreement("无法辨认", "123\\text{元}")).toBeNull();
    expect(formulaNumberDisagreement("123 元", "无法辨认")).toBeNull();
  });
});

describe("formula opinion operator cue", () => {
  it("flags a changed operation even when every number matches", () => {
    expect(formulaNumberDisagreement("100 - 20 = 80", "100 + 20 = 80")).toBe(false);
    expect(formulaOperatorDisagreement("100 - 20 = 80", "100 + 20 = 80")).toBe(true);
  });

  it("flags a missing equality sign without accepting matching numeric tokens", () => {
    expect(formulaOperatorDisagreement("利息 = 100 × 8%", "100 \\times 8\\%")).toBe(true);
  });

  it("treats common LaTeX math spellings as the same signs", () => {
    expect(formulaOperatorDisagreement(
      "利息 = (1,200 × 8%) ÷ 2 ≈ 48",
      "\\mathrm{利息}=\\left(1200\\times 8\\%\\right)\\div 2\\approx 48",
    )).toBe(false);
  });

  it("does not infer agreement from two expressions without recognizable signs", () => {
    expect(formulaOperatorDisagreement("无法辨认", "另一段文字")).toBeNull();
  });
});
