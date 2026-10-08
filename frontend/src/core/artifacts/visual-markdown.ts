const UNSUPPORTED_MARKDOWN = [
  { pattern: /<\/?[a-z][^>]*>/i, reason: "内嵌 HTML" },
  { pattern: /^\s*\[\^[^\]]+\]:/m, reason: "脚注" },
  { pattern: /\[\^[^\]]+\]/, reason: "脚注引用" },
  { pattern: /^\s*:::/m, reason: "自定义块" },
  { pattern: /^\s*\$\$\s*$/m, reason: "块级公式" },
  { pattern: /\\\[|\\\(|(?<!\\)\$(?!\s|\d)[^$\n]+\$/, reason: "公式" },
  { pattern: /^\s*\[[^\]]+\]:\s*\S+/m, reason: "引用式链接定义" },
] as const;

export function getVisualMarkdownUnsupportedReason(
  content: string,
): string | null {
  return (
    UNSUPPORTED_MARKDOWN.find(({ pattern }) => pattern.test(content))?.reason ??
    null
  );
}
