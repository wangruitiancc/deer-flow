import { describe, expect, it } from "@rstest/core";

import {
  getAuthenticatedHomePath,
  resolveAuthenticatedDestination,
} from "@/core/auth/role-routing";

describe("platform administrator routing", () => {
  it("always routes platform administrators to the operations console", () => {
    const admin = { system_role: "admin" as const };

    expect(getAuthenticatedHomePath(admin)).toBe("/admin");
    expect(resolveAuthenticatedDestination(admin, "/workspace/law")).toBe(
      "/admin",
    );
    expect(resolveAuthenticatedDestination(admin, "/onboarding")).toBe(
      "/admin",
    );
  });

  it("preserves customer destinations for regular users", () => {
    const user = { system_role: "user" as const };

    expect(getAuthenticatedHomePath(user)).toBe("/workspace/law");
    expect(resolveAuthenticatedDestination(user, "/application-status")).toBe(
      "/application-status",
    );
  });
});
