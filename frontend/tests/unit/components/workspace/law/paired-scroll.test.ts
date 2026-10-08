import { describe, expect, it } from "@rstest/core";

import { pairedScrollTop } from "@/components/workspace/law/paired-scroll";

describe("OCR paired scrolling", () => {
  it("tracks relative reading position across differently sized panes", () => {
    expect(pairedScrollTop(
      { scrollTop: 250, scrollHeight: 1500, clientHeight: 500 },
      { scrollHeight: 900, clientHeight: 400 },
    )).toBe(125);
  });

  it("does not move a pane without overflow", () => {
    expect(pairedScrollTop(
      { scrollTop: 0, scrollHeight: 500, clientHeight: 500 },
      { scrollHeight: 900, clientHeight: 400 },
    )).toBeNull();
  });
});
