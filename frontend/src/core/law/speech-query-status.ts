/** Query freshness is independent of the durable task's business status. */
export function speechQueryStatus({
  updatedAt,
  now,
  fetching,
  failed,
  paused,
  active,
}: {
  updatedAt?: number;
  now: number;
  fetching?: boolean;
  failed?: boolean;
  paused?: boolean;
  active: boolean;
}): string {
  const confirmed =
    typeof updatedAt === "number" &&
    Number.isFinite(updatedAt) &&
    updatedAt > 0;
  const checked = confirmed
    ? `最后核对 ${new Date(updatedAt).toLocaleTimeString("zh-CN", { hour12: false })}`
    : "尚未核对服务器状态";
  if (failed || paused || (active && confirmed && now - updatedAt > 15_000))
    return `${checked} · 状态可能未更新，请重新核对`;
  if (fetching) return `${checked} · 正在核对…`;
  return checked;
}
