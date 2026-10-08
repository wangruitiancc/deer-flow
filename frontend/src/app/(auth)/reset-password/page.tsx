"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import {
  AuthShell,
  authFieldClassName,
  authPrimaryButtonClassName,
} from "@/components/auth/auth-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  completePasswordReset,
  PasswordResetApiError,
} from "@/core/auth/password-reset";
import { useI18n } from "@/core/i18n/hooks";

export default function ResetPasswordPage() {
  const { t } = useI18n();
  const [token, setToken] = useState("");
  const [tokenChecked, setTokenChecked] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [complete, setComplete] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const fragment = window.location.hash.startsWith("#")
      ? window.location.hash.slice(1)
      : "";
    const resetToken = new URLSearchParams(fragment).get("token") ?? "";
    window.history.replaceState(
      window.history.state,
      "",
      `${window.location.pathname}${window.location.search}`,
    );
    setToken(resetToken);
    setTokenChecked(true);
  }, []);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    if (newPassword.length < 8) {
      setError(t.passwordReset.passwordTooShort);
      return;
    }
    if (newPassword !== confirmPassword) {
      setError(t.passwordReset.passwordMismatch);
      return;
    }

    setLoading(true);
    try {
      await completePasswordReset({ token, newPassword });
      setToken("");
      setNewPassword("");
      setConfirmPassword("");
      setComplete(true);
    } catch (reason) {
      if (reason instanceof PasswordResetApiError && reason.status === 400) {
        setToken("");
        setError(t.passwordReset.invalidLink);
      } else if (
        reason instanceof PasswordResetApiError &&
        reason.status === 422
      ) {
        setError(t.passwordReset.passwordRejected);
      } else {
        setError(t.passwordReset.networkError);
      }
    } finally {
      setLoading(false);
    }
  };

  const footer = (
    <Link
      href="/login"
      className="font-medium text-[#15523f] underline-offset-4 hover:underline"
    >
      {t.passwordReset.backToLogin}
    </Link>
  );

  return (
    <AuthShell
      title={t.passwordReset.resetTitle}
      subtitle={t.passwordReset.resetDescription}
      footer={footer}
    >
      {!tokenChecked ? (
        <p role="status" className="text-sm text-[#667074]">
          {t.login.pleaseWait}
        </p>
      ) : complete ? (
        <div className="space-y-4">
          <p role="status" className="border-l-2 border-[#15523f] pl-4 text-sm">
            {t.passwordReset.resetComplete}
          </p>
          <Link
            href="/login"
            className="inline-flex h-12 w-full items-center justify-center rounded-md bg-[#15523f] px-5 font-semibold text-white hover:bg-[#103f31]"
          >
            {t.passwordReset.signIn}
          </Link>
        </div>
      ) : !token ? (
        <p role="alert" className="border-l-2 border-amber-600 pl-4 text-sm">
          {t.passwordReset.invalidLink}
        </p>
      ) : (
        <form onSubmit={submit} className="space-y-5">
          <p className="text-sm text-[#667074]">
            {t.passwordReset.passwordHint}
          </p>
          <div className="space-y-2">
            <label htmlFor="new-password" className="text-sm font-semibold">
              {t.passwordReset.newPassword}
            </label>
            <Input
              id="new-password"
              type="password"
              autoComplete="new-password"
              value={newPassword}
              onChange={(event) => setNewPassword(event.currentTarget.value)}
              className={authFieldClassName}
              minLength={8}
              maxLength={1024}
              required
            />
          </div>
          <div className="space-y-2">
            <label
              htmlFor="confirm-password"
              className="text-sm font-semibold"
            >
              {t.passwordReset.confirmPassword}
            </label>
            <Input
              id="confirm-password"
              type="password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.currentTarget.value)}
              className={authFieldClassName}
              minLength={8}
              maxLength={1024}
              required
            />
          </div>
          {error && (
            <p role="alert" className="text-sm text-red-600">
              {error}
            </p>
          )}
          <Button
            type="submit"
            className={authPrimaryButtonClassName}
            disabled={loading}
          >
            {loading ? t.login.pleaseWait : t.passwordReset.resetPassword}
          </Button>
        </form>
      )}
    </AuthShell>
  );
}
