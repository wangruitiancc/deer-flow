import { afterEach, beforeEach, describe, expect, it, rs } from "@rstest/core";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

rs.mock("@/core/api/fetcher", () => ({
  fetch: rs.fn(),
  getCsrfHeaders: () => ({ "X-CSRF-Token": "csrf-test-token" }),
}));

rs.mock("@/core/auth/AuthProvider", () => ({
  useAuth: rs.fn(),
}));

rs.mock("@/core/i18n/hooks", () => ({
  useI18n: () => ({
    t: {
      settings: {
        account: {
          profileTitle: "Profile",
          email: "Email",
          role: "Role",
          ssoProvider: "SSO",
          changePasswordTitle: "Change password",
          changePasswordDescription: "Update your password.",
          ssoPasswordDescription: "Managed by SSO.",
          ssoPasswordMessage: "Use {provider} to manage your password.",
          currentPassword: "Current password",
          newPassword: "New password",
          confirmNewPassword: "Confirm new password",
          passwordMismatch: "Passwords do not match",
          passwordTooShort: "Password too short",
          passwordChangedSuccess: "Password changed",
          networkError: "Network error",
          updating: "Updating",
          updatePassword: "Update password",
          sessionSecurityTitle: "Session security",
          sessionSecurityDescription: "Sign out every device.",
          confirmRevokeAllSessions: "Revoke every session?",
          revokeAllSessions: "Sign out all devices",
          revokingAllSessions: "Revoking sessions",
          signOut: "Sign out",
        },
      },
    },
  }),
}));

import { AccountSettingsPage } from "@/components/workspace/settings/account-settings-page";
import { fetch as apiFetch } from "@/core/api/fetcher";
import { useAuth } from "@/core/auth/AuthProvider";

const mockedFetch = rs.mocked(apiFetch);
const mockedUseAuth = rs.mocked(useAuth);

beforeEach(() => {
  mockedUseAuth.mockReturnValue({
    user: {
      id: "synthetic-lawyer",
      email: "lawyer@example.com",
      system_role: "user",
      needs_setup: false,
      oauth_provider: null,
    },
    isAuthenticated: true,
    isLoading: false,
    logout: rs.fn(),
    refreshUser: rs.fn(),
    applyUser: rs.fn(),
  } as ReturnType<typeof useAuth>);
  mockedFetch.mockReset();
});

afterEach(() => {
  cleanup();
  rs.restoreAllMocks();
});

describe("AccountSettingsPage session revocation", () => {
  it("sends a CSRF-protected revoke request and displays a failure", async () => {
    mockedFetch.mockResolvedValueOnce({
      ok: false,
      json: async () => ({ detail: "Session revocation denied" }),
    } as Response);
    rs.spyOn(window, "confirm").mockReturnValue(true);
    render(<AccountSettingsPage />);

    fireEvent.click(screen.getByRole("button", { name: "Sign out all devices" }));

    await waitFor(() => {
      expect(mockedFetch).toHaveBeenCalledWith("/api/v1/auth/sessions/revoke-all", {
        method: "POST",
        headers: { "X-CSRF-Token": "csrf-test-token" },
      });
    });
    expect(await screen.findByRole("alert")).toBeTruthy();
  });

  it("does nothing when the user cancels the confirmation", () => {
    rs.spyOn(window, "confirm").mockReturnValue(false);
    render(<AccountSettingsPage />);

    fireEvent.click(screen.getByRole("button", { name: "Sign out all devices" }));

    expect(mockedFetch).not.toHaveBeenCalled();
  });
});
