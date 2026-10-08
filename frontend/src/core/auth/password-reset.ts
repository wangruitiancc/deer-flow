export type PasswordResetStatus = { enabled: boolean };
export type PasswordResetMessage = { message: string };

export class PasswordResetApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function readMessage(response: Response): Promise<PasswordResetMessage> {
  const payload = (await response.json()) as Partial<PasswordResetMessage> & {
    detail?: string | { message?: string };
  };
  if (!response.ok) {
    const detail =
      typeof payload.detail === "string"
        ? payload.detail
        : payload.detail?.message;
    throw new PasswordResetApiError(
      detail ?? `Password reset request failed (${response.status})`,
      response.status,
    );
  }
  if (typeof payload.message !== "string") {
    throw new Error("Password reset response was invalid");
  }
  return { message: payload.message };
}

export async function fetchPasswordResetStatus(): Promise<PasswordResetStatus> {
  const response = await fetch("/api/v1/auth/password-reset/status", {
    method: "GET",
    cache: "no-store",
    credentials: "same-origin",
  });
  if (!response.ok) throw new Error("Password reset status is unavailable");
  const payload = (await response.json()) as Partial<PasswordResetStatus>;
  return { enabled: payload.enabled === true };
}

export async function requestPasswordReset(
  email: string,
): Promise<PasswordResetMessage> {
  return readMessage(
    await fetch("/api/v1/auth/password-reset/request", {
      method: "POST",
      cache: "no-store",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    }),
  );
}

export async function completePasswordReset(input: {
  token: string;
  newPassword: string;
}): Promise<PasswordResetMessage> {
  return readMessage(
    await fetch("/api/v1/auth/password-reset/complete", {
      method: "POST",
      cache: "no-store",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        token: input.token,
        new_password: input.newPassword,
      }),
    }),
  );
}
