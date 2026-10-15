export function buildLoginUrl(returnPath: string): string {
  return `/login?next=${encodeURIComponent(returnPath)}`;
}
