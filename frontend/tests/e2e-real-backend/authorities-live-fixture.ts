export function createAuthoritiesLiveFixture(size: "small" | "large") {
  const original = {
    code: "合成历史法律",
    article: "第一条",
    origin: "manual",
    addedAt: "unknown",
    text: null,
    source: "javascript:inert-legacy-reference",
  };
  const count = size === "large" ? 500 : 2;
  const records = [
    original,
    ...Array.from({ length: count - 1 }, (_, index) => ({
      ...original,
      text:
        size === "large"
          ? "合成😀\r\n".repeat(40) + `合成尾部${index + 1}`
          : "合成旧摘录，仅测试迁移，不是现行法律。",
    })),
  ];
  return {
    original,
    count,
    legacy:
      "\ufeff[\r\n" +
      records.map((item) => JSON.stringify(item)).join(",") +
      "\r\n]",
  };
}
