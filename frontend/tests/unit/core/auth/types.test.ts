import { describe, expect, test } from "@rstest/core";

import { parseAuthError } from "@/core/auth/types";

describe("parseAuthError", () => {
  test("keeps invite registration messages from the Gateway", () => {
    expect(
      parseAuthError({
        detail: {
          code: "invalid_invitation",
          message: "Invitation is invalid or expired",
        },
      }),
    ).toEqual({
      code: "invalid_invitation",
      message: "Invitation is invalid or expired",
    });
  });
});
