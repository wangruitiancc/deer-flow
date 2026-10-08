import { afterEach, beforeEach, describe, expect, it, rs } from "@rstest/core";

import {
  completePasswordReset,
  fetchPasswordResetStatus,
  PasswordResetApiError,
  requestPasswordReset,
} from "@/core/auth/password-reset";

const fetchMock = rs.fn();

function response(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

describe("password recovery client", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    rs.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    rs.unstubAllGlobals();
  });

  it("reads availability without browser caching", async () => {
    fetchMock.mockResolvedValue(response({ enabled: true }));

    await expect(fetchPasswordResetStatus()).resolves.toEqual({ enabled: true });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/auth/password-reset/status",
      expect.objectContaining({ cache: "no-store", credentials: "same-origin" }),
    );
  });

  it("sends the account address to the generic request endpoint", async () => {
    fetchMock.mockResolvedValue(response({ message: "accepted" }, 202));

    await expect(requestPasswordReset("lawyer@example.com")).resolves.toEqual({
      message: "accepted",
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/auth/password-reset/request",
      expect.objectContaining({
        method: "POST",
        cache: "no-store",
        body: JSON.stringify({ email: "lawyer@example.com" }),
      }),
    );
  });

  it("sends reset credentials in the request body, never in the request URL", async () => {
    fetchMock.mockResolvedValue(response({ message: "complete" }));

    await expect(
      completePasswordReset({ token: "signed-reset-token", newPassword: "NewStr0ngPwd!" }),
    ).resolves.toEqual({ message: "complete" });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/v1/auth/password-reset/complete");
    expect(init.body).toBe(
      JSON.stringify({ token: "signed-reset-token", new_password: "NewStr0ngPwd!" }),
    );
  });

  it("preserves the response status for safe UI error handling", async () => {
    fetchMock.mockResolvedValue(response({ detail: "invalid" }, 400));

    await expect(
      completePasswordReset({ token: "signed-reset-token", newPassword: "NewStr0ngPwd!" }),
    ).rejects.toBeInstanceOf(PasswordResetApiError);
    await expect(
      completePasswordReset({ token: "signed-reset-token", newPassword: "NewStr0ngPwd!" }),
    ).rejects.toMatchObject({ status: 400 });
  });
});
