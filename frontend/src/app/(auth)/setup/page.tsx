"use client";

import { ArrowRightIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import {
  AuthShell,
  authFieldClassName,
  authPrimaryButtonClassName,
} from "@/components/auth/auth-shell";
import { RememberSessionOption } from "@/components/auth/remember-session-option";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getCsrfHeaders } from "@/core/api/fetcher";
import { useAuth } from "@/core/auth/AuthProvider";
import { loadRememberLoginPreference } from "@/core/auth/remember-login";
import { getAuthenticatedHomePath } from "@/core/auth/role-routing";
import {
  fetchSetupStatus,
  isSystemAlreadyInitializedError,
} from "@/core/auth/setup";
import { parseAuthError } from "@/core/auth/types";
import { useI18n } from "@/core/i18n/hooks";

type SetupMode = "loading" | "init_admin" | "change_password" | "unavailable";

export default function SetupPage() {
  const router = useRouter();
  const { user, isAuthenticated } = useAuth();
  const { t } = useI18n();
  const [mode, setMode] = useState<SetupMode>("loading");
  const [setupStatusAttempt, setSetupStatusAttempt] = useState(0);
  const [email, setEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [rememberMe, setRememberMe] = useState(
    () => loadRememberLoginPreference().rememberMe,
  );

  useEffect(() => {
    let cancelled = false;
    if (isAuthenticated && user?.needs_setup) {
      setMode("change_password");
    } else if (!isAuthenticated) {
      setMode("loading");
      void fetchSetupStatus()
        .then((data) => {
          if (cancelled) return;
          if (data.needs_setup) setMode("init_admin");
          else router.replace("/login");
        })
        .catch(() => {
          if (!cancelled) setMode("unavailable");
        });
    } else {
      if (user) router.replace(getAuthenticatedHomePath(user));
    }
    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, router, setupStatusAttempt, user]);

  const validatePasswords = () => {
    if (newPassword.length < 8) {
      setError("密码至少需要 8 位字符。");
      return false;
    }
    if (newPassword !== confirmPassword) {
      setError("两次输入的密码不一致。");
      return false;
    }
    return true;
  };

  const handleInitAdmin = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    if (!validatePasswords()) return;
    setLoading(true);
    try {
      const response = await fetch("/api/v1/auth/initialize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          email,
          password: newPassword,
          remember_me: rememberMe,
        }),
      });
      if (!response.ok) {
        const data = await response.json();
        if (isSystemAlreadyInitializedError(data)) {
          router.replace("/login");
          return;
        }
        setError(parseAuthError(data).message);
        return;
      }
      router.push("/admin");
    } catch {
      setError("无法连接服务器，请稍后重试。");
    } finally {
      setLoading(false);
    }
  };

  const handleChangePassword = async (
    event: React.FormEvent<HTMLFormElement>,
  ) => {
    event.preventDefault();
    setError("");
    if (!validatePasswords()) return;
    setLoading(true);
    try {
      const response = await fetch("/api/v1/auth/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getCsrfHeaders() },
        credentials: "include",
        body: JSON.stringify({
          current_password: currentPassword,
          new_password: newPassword,
          new_email: email || undefined,
          remember_me: rememberMe,
        }),
      });
      if (!response.ok) {
        setError(parseAuthError(await response.json()).message);
        return;
      }
      if (user) router.push(getAuthenticatedHomePath(user));
    } catch {
      setError("无法连接服务器，请稍后重试。");
    } finally {
      setLoading(false);
    }
  };

  if (mode === "loading") {
    return (
      <AuthShell
        title="正在检查系统状态"
        subtitle="请稍候，正在准备管理员账户设置。"
      >
        <p role="status" className="text-sm text-[#667074]">
          正在读取初始化状态…
        </p>
      </AuthShell>
    );
  }

  if (mode === "unavailable") {
    return (
      <AuthShell
        title={t.login.serviceUnavailableTitle}
        subtitle={t.login.serviceUnavailableDescription}
      >
        <div className="flex flex-wrap gap-3">
          <Button
            type="button"
            className="bg-[#15523f] text-white hover:bg-[#123f32]"
            onClick={() => {
              setMode("loading");
              setSetupStatusAttempt((attempt) => attempt + 1);
            }}
          >
            {t.login.retry}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => router.replace("/login")}
          >
            {t.login.signIn}
          </Button>
        </div>
      </AuthShell>
    );
  }

  const changingPassword = mode === "change_password";
  return (
    <AuthShell
      title={
        changingPassword ? "完成管理员账户设置" : "初始化 Matrix-Law 管理员"
      }
      subtitle={
        changingPassword
          ? "设置真实工作邮箱和新密码后进入管理工作区。"
          : "创建首个平台管理员账户，随后再配置租户和成员。"
      }
    >
      <form
        onSubmit={changingPassword ? handleChangePassword : handleInitAdmin}
        className="space-y-5"
      >
        <div className="space-y-2">
          <label htmlFor="setup-email" className="text-sm font-semibold">
            工作邮箱
          </label>
          <Input
            id="setup-email"
            type="email"
            autoComplete="email"
            placeholder="请输入管理员工作邮箱"
            value={email}
            onChange={(event) => setEmail(event.currentTarget.value)}
            className={authFieldClassName}
            required
          />
        </div>

        {changingPassword && (
          <div className="space-y-2">
            <label htmlFor="current-password" className="text-sm font-semibold">
              当前密码
            </label>
            <Input
              id="current-password"
              type="password"
              autoComplete="current-password"
              placeholder="请输入当前密码"
              value={currentPassword}
              onChange={(event) =>
                setCurrentPassword(event.currentTarget.value)
              }
              className={authFieldClassName}
              required
            />
          </div>
        )}

        <div className="space-y-2">
          <label htmlFor="new-password" className="text-sm font-semibold">
            {changingPassword ? "新密码" : "密码"}
          </label>
          <Input
            id="new-password"
            type="password"
            autoComplete="new-password"
            placeholder="至少 8 位字符"
            value={newPassword}
            onChange={(event) => setNewPassword(event.currentTarget.value)}
            className={authFieldClassName}
            minLength={8}
            required
          />
        </div>

        <div className="space-y-2">
          <label htmlFor="confirm-password" className="text-sm font-semibold">
            确认密码
          </label>
          <Input
            id="confirm-password"
            type="password"
            autoComplete="new-password"
            placeholder="请再次输入密码"
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.currentTarget.value)}
            className={authFieldClassName}
            minLength={8}
            required
          />
        </div>

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
          <span>
            {loading
              ? "正在保存…"
              : changingPassword
                ? "完成设置"
                : "创建管理员账户"}
          </span>
          {!loading && <ArrowRightIcon />}
        </Button>
      </form>
    </AuthShell>
  );
}
