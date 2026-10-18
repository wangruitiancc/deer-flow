import type { ManagementTenantListItem } from "./types";

// Navigation only: management APIs reauthorize every subsequent request.
export function hasFinanceEntry(items: ManagementTenantListItem[]): boolean {
  return items.some(
    ({ membership }) =>
      membership.status === "active" && membership.role === "finance",
  );
}
