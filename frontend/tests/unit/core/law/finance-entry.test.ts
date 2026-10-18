import { describe, expect, it } from "@rstest/core";

import { hasFinanceEntry } from "@/core/law/finance-entry";
import type { ManagementTenantListItem } from "@/core/law/types";

function item(role: string, status = "active"): ManagementTenantListItem {
  return {
    tenant: { id: "synthetic", name: "Synthetic" },
    membership: { role, status },
  } as ManagementTenantListItem;
}

describe("finance entry from authenticated management metadata", () => {
  it("opens management for active finance without requiring a lawyer workspace", () => {
    expect(hasFinanceEntry([item("finance")])).toBe(true);
  });
  it("does not infer finance access from empty, ordinary, or unknown roles", () => {
    for (const rows of [
      [],
      [item("member")],
      [item("owner")],
      [item("admin")],
      [item("unknown")],
    ]) {
      expect(hasFinanceEntry(rows)).toBe(false);
    }
  });
  it("ignores suspended, invited and departed finance memberships", () => {
    for (const status of ["suspended", "invited", "left"]) {
      expect(hasFinanceEntry([item("finance", status)])).toBe(false);
    }
  });
});
