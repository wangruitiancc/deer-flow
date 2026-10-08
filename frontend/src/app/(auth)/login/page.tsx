"use client";

import { EyeIcon, EyeOffIcon, LogInIcon } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

import {
  AuthShell,
  authFieldClassName,
  authPrimaryButtonClassName,
} from "@/components/auth/auth-shell";
import { RememberSessionOption } from "@/components/auth/remember-session-option";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/core/auth/AuthProvider";
import { resolveAuthNextPath } from "@/core/auth/next-path";
import { fetchPasswordResetStatus } from "@/core/auth/password-reset";
import {
  loadRememberLoginPreference,
  saveRememberLoginPreference,
} from "@/core/auth/remember-login";
import { resolveAuthenticatedDestination } from "@/core/auth/role-routing";
import {
  canCreateRegularAccount,
  fetchSetupStatus,
  type SetupStatusResponse,
} from "@/core/auth/setup";
import { parseAuthError, userSchema } from "@/core/auth/types";
import { useI18n } from "@/core/i18n/hooks";

type MFASetupResponse = {
  secret: string;
  otpauth_uri: string;
  recovery_codes: string[];
};

export default function LoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { applyUser, isAuthenticated, user } = useAuth();
  const { t } = useI18n();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);
  const [ssoProviders, setSsoProviders] = useState<
    { id: string; display_name: string; type: string }[]
  >([]);
  const [setupStatus, setSetupStatus] = useState<SetupStatusResponse | null>(
    null,
  );
  const [setupStatusPhase, setSetupStatusPhase] = useState<
    "checking" | "ready" | "unavailable"
  >("checking");
  const [setupStatusAttempt, setSetupStatusAttempt] = useState(0);
  const errorParam = searchParams.get("error");
  const [error, setError] = useState(
    errorParam
      ? (t.login.errors[errorParam as keyof typeof t.login.errors] ??
          t.login.authFailed)
      : "",
  );
  const [showSsoHint, setShowSsoHint] = useState(false);
  const [loading, setLoading] = useState(false);
  const [passwordResetEnabled, setPasswordResetEnabled] = useState(false);
  const [mfaMode, setMfaMode] = useState<"setup" | "verify" | null>(null);
  const [mfaSetup, setMfaSetup] = useState<MFASetupResponse | null>(null);
  const [mfaCode, setMfaCode] = useState("");
  const [recoveryCodesSaved, setRecoveryCodesSaved] = useState(false);

  const redirectPath = resolveAuthNextPath(searchParams.get("next"));
  const regularSignupAllowed = canCreateRegularAccount({
    checked: setupStatusPhase === "ready",
    status: setupStatus,
  });
  const systemNeedsAdminSetup = setupStatus?.needs_setup === true;
  const showSetupStatusUnavailable =
    setupStatusPhase === "unavailable" ||
    (setupStatusAttempt > 0 && setupStatusPhase === "checking");

  useEffect(() => {
    if (isAuthenticated) {
      if (user) {
        router.push(resolveAuthenticatedDestination(user, redirectPath));
      }
    }
  }, [isAuthenticated, redirectPath, router, user]);

  useEffect(() => {
    const preference = loadRememberLoginPreference();
    setRememberMe(preference.rememberMe);
    if (preference.email) setEmail(preference.email);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setSetupStatusPhase("checking");
    void fetchSetupStatus()
      .then((data) => {
        if (cancelled) return;
        setSetupStatus(data);
        setSetupStatusPhase("ready");
      })
      .catch(() => {
        if (!cancelled) {
          setSetupStatus(null);
          setSetupStatusPhase("unavailable");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [setupStatusAttempt]);

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/v1/auth/providers")
      .then((response) => response.json())
      .then(
        (data: {
          providers: { id: string; display_name: string; type: string }[];
        }) => {
          if (!cancelled) setSsoProviders(data.providers ?? []);
        },
      )
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void fetchPasswordResetStatus()
      .then(({ enabled }) => {
        if (!cancelled) setPasswordResetEnabled(enabled);
      })
      .catch(() => {
        if (!cancelled) setPasswordResetEnabled(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const finishLogin = async () => {
    saveRememberLoginPreference({ email, rememberMe });
    const meResponse = await fetch("/api/v1/auth/me", {
      credentials: "include",
    });
    if (!meResponse.ok) {
      setError("登录成功，但无法读取账户角色，请重新登录。");
      return;
    }
    const parsedUser = userSchema.safeParse(await meResponse.json());
    if (!parsedUser.success) {
      setError("账户角色数据异常，请联系平台运营人员。");
      return;
    }
    applyUser(parsedUser.data);
    router.push(resolveAuthenticatedDestination(parsedUser.data, redirectPath));
  };

  const beginMfaSetup = async () => {
    const response = await fetch("/api/v1/auth/mfa/setup", {
      method: "POST",
      credentials: "include",
    });
    if (!response.ok) {
      setError("无法开始管理员双重验证设置，请重试或联系平台管理员。");
      return;
    }
    setMfaSetup((await response.json()) as MFASetupResponse);
    setError("");
  };

  const handleMfaSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    if (mfaMode === "setup" && !recoveryCodesSaved) {
      setError(t.login.mfaSaveRecoveryCodesFirst);
      return;
    }
    setLoading(true);
    try {
      const endpoint =
        mfaMode === "setup"
          ? "/api/v1/auth/mfa/setup/confirm"
          : "/api/v1/auth/mfa/verify";
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: mfaCode }),
        credentials: "include",
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        setError(
          typeof body?.detail === "string"
            ? body.detail
            : t.login.mfaCodeInvalid,
        );
        return;
      }
      await finishLogin();
    } catch {
      setError(t.login.networkError);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setShowSsoHint(false);
    setLoading(true);
    try {
      const response = await fetch("/api/v1/auth/login/local", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          password,
          remember_me: String(rememberMe),
          username: email,
        }),
        credentials: "include",
      });
      if (!response.ok) {
        const authError = parseAuthError(await response.json());
        setError(authError.message);
        if (ssoProviders.length > 0) setShowSsoHint(true);
        return;
      }
      const loginResult = (await response.json()) as {
        mfa_required?: boolean;
        mfa_setup_required?: boolean;
      };
      if (loginResult.mfa_required) {
        const mode = loginResult.mfa_setup_required ? "setup" : "verify";
        setMfaMode(mode);
        setError("");
        if (mode === "setup") await beginMfaSetup();
        return;
      }
      await finishLogin();
    } catch {
      setError(t.login.networkError);
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell
      title="登录 Matrix-Law"
      subtitle="系统会根据账户角色进入平台运营后台或法律工作区。"
      footer={
        <div className="space-y-4 text-center text-sm text-[#667074]">
          {regularSignupAllowed && (
            <p>
              还没有账号？{" "}
              <Link
                className="font-medium text-[#15523f] underline-offset-4 hover:underline"
                href="/register"
              >
                创建账户
              </Link>
            </p>
          )}
          <Link
            href="/"
            className="inline-block text-xs underline-offset-4 hover:underline"
          >
            {t.login.backToHome}
          </Link>
        </div>
      }
    >
      <div className="space-y-5">
        {mfaMode ? (
          <form onSubmit={handleMfaSubmit} className="space-y-5">
            <div className="space-y-2">
              <h2 className="text-lg font-semibold">
                {mfaMode === "setup"
                  ? t.login.mfaSetupTitle
                  : t.login.mfaVerifyTitle}
              </h2>
              <p className="text-sm text-[#667074]">
                {mfaMode === "setup"
                  ? t.login.mfaSetupDescription
                  : t.login.mfaVerifyDescription}
              </p>
            </div>

            {mfaMode === "setup" && mfaSetup && (
              <div className="space-y-4 rounded-lg border border-[#c6c9c7] p-4">
                <div className="space-y-2 text-sm">
                  <p className="font-medium">{t.login.mfaAuthenticatorSecret}</p>
                  <code className="block break-all rounded bg-[#f2f4f2] p-3 text-xs">
                    {mfaSetup.secret}
                  </code>
                  <p className="break-all text-xs text-[#667074]">
                    {mfaSetup.otpauth_uri}
                  </p>
                </div>
                <div className="space-y-2 text-sm">
                  <p className="font-medium">{t.login.mfaRecoveryCodes}</p>
                  <p className="text-[#667074]">
                    {t.login.mfaRecoveryCodesDescription}
                  </p>
                  <ul className="grid grid-cols-2 gap-2 font-mono text-xs">
                    {mfaSetup.recovery_codes.map((code) => (
                      <li key={code} className="rounded bg-[#f2f4f2] p-2">
                        {code}
                      </li>
                    ))}
                  </ul>
                </div>
                <label className="flex items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={recoveryCodesSaved}
                    onChange={(event) =>
                      setRecoveryCodesSaved(event.currentTarget.checked)
                    }
                    className="mt-1"
                  />
                  <span>{t.login.mfaRecoveryCodesSaved}</span>
                </label>
              </div>
            )}

            {mfaMode === "setup" && !mfaSetup && (
              <Button
                type="button"
                variant="outline"
                className="w-full"
                disabled={loading}
                onClick={() => void beginMfaSetup()}
              >
                {loading ? t.login.pleaseWait : t.login.mfaRetrySetup}
              </Button>
            )}

            {(mfaMode === "verify" || mfaSetup) && (
              <div className="space-y-2">
                <label htmlFor="mfa-code" className="text-sm font-semibold">
                  {t.login.mfaCodeLabel}
                </label>
                <Input
                  id="mfa-code"
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  value={mfaCode}
                  onChange={(event) => setMfaCode(event.currentTarget.value)}
                  className={authFieldClassName}
                  required
                  minLength={6}
                  maxLength={64}
                />
              </div>
            )}

            {error && (
              <p role="alert" className="text-sm text-red-600">
                {error}
              </p>
            )}
            {(mfaMode === "verify" || mfaSetup) && (
              <Button
                type="submit"
                className={authPrimaryButtonClassName}
                disabled={loading || (mfaMode === "setup" && !recoveryCodesSaved)}
              >
                {loading ? t.login.pleaseWait : t.login.mfaContinue}
              </Button>
            )}
          </form>
        ) : (
          <>
        {showSetupStatusUnavailable && (
          <div
            role="status"
            aria-live="polite"
            className="border-l-2 border-amber-600 pl-4 text-sm"
          >
            <p className="font-medium">{t.login.serviceUnavailableTitle}</p>
            <p className="mt-1 text-[#667074]">
              {t.login.serviceUnavailableDescription}
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-3 border-[#b8bebc] bg-transparent"
              disabled={setupStatusPhase === "checking"}
              onClick={() => {
                setSetupStatusPhase("checking");
                setSetupStatusAttempt((attempt) => attempt + 1);
              }}
            >
              {setupStatusPhase === "checking"
                ? t.login.pleaseWait
                : t.login.retry}
            </Button>
          </div>
        )}

        {systemNeedsAdminSetup && (
          <div className="border-l-2 border-[#15523f] pl-4 text-sm">
            <p className="font-medium">{t.login.adminSetupRequiredTitle}</p>
            <p className="mt-1 text-[#667074]">
              {t.login.adminSetupRequiredDescription}
            </p>
            <Link
              className="mt-2 inline-block font-medium text-[#15523f] hover:underline"
              href="/setup"
            >
              {t.login.createAdminAccount}
            </Link>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="space-y-2">
            <label htmlFor="email" className="text-sm font-semibold">
              工作邮箱
            </label>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.currentTarget.value)}
              placeholder="请输入你的工作邮箱"
              className={authFieldClassName}
              required
            />
          </div>

          <div className="space-y-2">
            <label htmlFor="password" className="text-sm font-semibold">
              密码
            </label>
            <div className="relative">
              <Input
                id="password"
                type={showPassword ? "text" : "password"}
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.currentTarget.value)}
                placeholder="请输入密码"
                className={`${authFieldClassName} pr-12`}
                required
                minLength={6}
              />
              <button
                type="button"
                className="absolute inset-y-0 right-0 flex w-12 items-center justify-center text-[#596369] hover:text-[#15523f] focus-visible:outline-2 focus-visible:outline-offset-[-4px] focus-visible:outline-[#15523f]"
                onClick={() => setShowPassword((visible) => !visible)}
                aria-label={showPassword ? "隐藏密码" : "显示密码"}
              >
                {showPassword ? <EyeOffIcon /> : <EyeIcon />}
              </button>
            </div>
          </div>

          {passwordResetEnabled && (
            <div className="-mt-2 text-right text-sm">
              <Link
                className="font-medium text-[#15523f] underline-offset-4 hover:underline"
                href="/forgot-password"
              >
                {t.login.forgotPassword}
              </Link>
            </div>
          )}

          <RememberSessionOption
            checked={rememberMe}
            onCheckedChange={setRememberMe}
          />
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
            {loading ? (
              t.login.pleaseWait
            ) : (
              <>
                <span>登录</span>
                <LogInIcon />
              </>
            )}
          </Button>
        </form>

        {ssoProviders.length > 0 && (
          <div className="space-y-3">
            <div className="flex items-center gap-4 text-xs text-[#7a8184]">
              <span className="h-px flex-1 bg-[#c6c9c7]" />
              <span>{t.login.orContinueWith}</span>
              <span className="h-px flex-1 bg-[#c6c9c7]" />
            </div>
            {showSsoHint && (
              <p className="text-center text-sm text-[#667074]">
                {t.login.ssoHint}
              </p>
            )}
            {ssoProviders.map((provider) => (
              <Button
                key={provider.id}
                type="button"
                variant="outline"
                className="h-12 w-full border-[#b8bebc] bg-transparent"
                disabled={loading}
                onClick={() => {
                  window.location.href = `/api/v1/auth/oauth/${provider.id}?next=${encodeURIComponent(redirectPath)}&remember_me=${String(rememberMe)}`;
                }}
              >
                {t.login.continueWith(provider.display_name)}
              </Button>
            ))}
          </div>
        )}
          </>
        )}
      </div>
    </AuthShell>
  );
}
