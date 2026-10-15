import { describe, expect, it } from "@rstest/core";

import { speechQueryStatus } from "@/core/law/speech-query-status";

describe("speech query freshness", () => {
  it("does not claim confirmation without a successful read timestamp", () => {
    expect(speechQueryStatus({ now: 100_000, active: true })).toBe(
      "尚未核对服务器状态",
    );
  });
  it("warns for a stale queued/processing result without changing the durable task status", () => {
    expect(
      speechQueryStatus({ now: 100_000, updatedAt: 80_000, active: true }),
    ).toContain("状态可能未更新");
    expect(
      speechQueryStatus({ now: 100_000, updatedAt: 80_000, active: false }),
    ).not.toContain("状态可能未更新");
  });
  it("distinguishes refreshing, a failed read and a paused offline read", () => {
    expect(
      speechQueryStatus({
        now: 100_000,
        updatedAt: 99_000,
        active: true,
        fetching: true,
      }),
    ).toContain("正在核对");
    for (const state of [{ failed: true }, { paused: true }])
      expect(
        speechQueryStatus({
          now: 100_000,
          updatedAt: 99_000,
          active: true,
          ...state,
        }),
      ).toContain("状态可能未更新");
  });
});
