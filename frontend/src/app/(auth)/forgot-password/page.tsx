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
  fetchPasswordResetStatus,
  requestPasswordReset,
} from "@/core/auth/password-reset";
import { useI18n } from "@/core/i18n/hooks";

export default function ForgotPasswordPage() {
  const { t } = useI18n();
  const [email, setEmail] = useState("");
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    void fetchPasswordResetStatus()
      .then(({ enabled: configured }) => {
        if (!cancelled) setEnabled(configured);
      })
      .catch(() => {
        if (!cancelled) setEnabled(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setLoading(true);
    try {
      await requestPasswordReset(email.trim());
      setSubmitted(true);
    } catch {
      setError(t.passwordReset.requestFailed);
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
      title={t.passwordReset.requestTitle}
      subtitle={t.passwordReset.requestDescription}
      footer={footer}
    >
      {enabled === null ? (
        <p role="status" className="text-sm text-[#667074]">
          {t.login.pleaseWait}
        </p>
      ) : !enabled ? (
        <p role="status" className="border-l-2 border-amber-600 pl-4 text-sm">
          {t.passwordReset.featureUnavailable}
        </p>
      ) : submitted ? (
        <p role="status" className="border-l-2 border-[#15523f] pl-4 text-sm">
          {t.passwordReset.requestSubmitted}
        </p>
      ) : (
        <form onSubmit={submit} className="space-y-5">
          <div className="space-y-2">
            <label htmlFor="email" className="text-sm font-semibold">
              {t.passwordReset.email}
            </label>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.currentTarget.value)}
              placeholder={t.passwordReset.emailPlaceholder}
              className={authFieldClassName}
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
            {loading ? t.login.pleaseWait : t.passwordReset.sendLink}
          </Button>
        </form>
      )}
    </AuthShell>
  );
}
