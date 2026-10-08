"use client";

import {
  ArrowRightIcon,
  Building2Icon,
  EyeIcon,
  EyeOffIcon,
  ShieldCheckIcon,
  UserRoundIcon,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import {
  AuthShell,
  authFieldClassName,
  authPrimaryButtonClassName,
} from "@/components/auth/auth-shell";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { saveRememberLoginPreference } from "@/core/auth/remember-login";
import {
  canCreateRegularAccount,
  fetchSetupStatus,
  type SetupStatusResponse,
} from "@/core/auth/setup";
import { parseAuthError } from "@/core/auth/types";
import { submitOnboardingApplication } from "@/core/law";

type RegistrationStep = 1 | 2 | 3;
type RegistrationAccess = "checking" | "allowed" | "blocked" | "unavailable";
type LegalDocument = "terms" | "privacy" | null;

const STEPS = [{ label: "账号" }, { label: "组织" }, { label: "个人用量" }];
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function suggestedSlug(email: string): string {
  return (
    email
      .split("@")[0]
      ?.toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") ?? ""
  );
}
export default function RegisterPage() {
  const router = useRouter();
  const [step, setStep] = useState<RegistrationStep>(1);
  const [access, setAccess] = useState<RegistrationAccess>("checking");
  const [setupStatus, setSetupStatus] = useState<SetupStatusResponse | null>(
    null,
  );
  const [setupAttempt, setSetupAttempt] = useState(0);
  const [email, setEmail] = useState("");
  const [invitationToken, setInvitationToken] = useState("");
  const [invitationMode, setInvitationMode] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [organizationName, setOrganizationName] = useState("");
  const [organizationSlug, setOrganizationSlug] = useState("");
  const [slugWasEdited, setSlugWasEdited] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [legalDocument, setLegalDocument] = useState<LegalDocument>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setAccess("checking");
    void fetchSetupStatus()
      .then((status) => {
        if (cancelled) return;
        setSetupStatus(status);
        setAccess(
          canCreateRegularAccount({ checked: true, status })
            ? "allowed"
            : "blocked",
        );
      })
      .catch(() => {
        if (!cancelled) setAccess("unavailable");
      });
    return () => {
      cancelled = true;
    };
  }, [setupAttempt]);

  useEffect(() => {
    if (step !== 2 || slugWasEdited || organizationSlug) return;
    setOrganizationSlug(suggestedSlug(email));
  }, [email, organizationSlug, slugWasEdited, step]);

  const registerAccount = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    if (password.length < 8) {
      setError("密码至少需要 8 位字符。");
      return;
    }
    if (password !== confirmPassword) {
      setError("两次输入的密码不一致。");
      return;
    }
    if (!termsAccepted) {
      setError("请先阅读并同意服务条款和隐私政策。");
      return;
    }

    setLoading(true);
    try {
      const response = await fetch("/api/v1/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email, password, remember_me: true }),
      });
      if (!response.ok) {
        setError(parseAuthError(await response.json()).message);
        return;
      }
      saveRememberLoginPreference({ email, rememberMe: true });
      setStep(2);
      router.push("/onboarding");
    } catch {
      setError("无法连接服务器，请检查网络后重试。");
    } finally {
      setLoading(false);
    }
  };

  const registerWithInvitation = async (
    event: React.FormEvent<HTMLFormElement>,
  ) => {
    event.preventDefault();
    setError("");
    if (password.length < 8) {
      setError("密码至少需要 8 位字符。");
      return;
    }
    if (password !== confirmPassword) {
      setError("两次输入的密码不一致。");
      return;
    }
    if (!termsAccepted) {
      setError("请先阅读并同意服务条款和隐私政策。");
      return;
    }

    setLoading(true);
    try {
      const response = await fetch("/api/v1/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          email,
          password,
          remember_me: true,
          invitation_token: invitationToken.trim(),
        }),
      });
      if (!response.ok) {
        setError(parseAuthError(await response.json()).message);
        return;
      }
      saveRememberLoginPreference({ email, rememberMe: true });
      router.push("/workspace/law");
    } catch {
      setError("无法连接服务器，请检查网络后重试。");
    } finally {
      setLoading(false);
    }
  };

  const submitOrganization = async (
    event: React.FormEvent<HTMLFormElement>,
  ) => {
    event.preventDefault();
    setError("");
    if (!SLUG_PATTERN.test(organizationSlug)) {
      setError(
        "组织标识只能包含小写字母、数字和连字符，且不能以连字符开头或结尾。",
      );
      return;
    }

    setLoading(true);
    try {
      await submitOnboardingApplication({
        application_type: "law_firm",
        organization_name: organizationName.trim(),
        desired_slug: organizationSlug,
        display_name: displayName.trim() || undefined,
      });
      setStep(3);
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "提交申请失败，请稍后重试。",
      );
    } finally {
      setLoading(false);
    }
  };

  const footer = (
    <div className="flex items-center gap-5 text-sm text-[#667074] before:h-px before:flex-1 before:bg-[#c6c9c7] after:h-px after:flex-1 after:bg-[#c6c9c7]">
      <span className="whitespace-nowrap">
        已有账号，{" "}
        <Link
          href="/login"
          className="font-medium text-[#15523f] underline-offset-4 hover:underline"
        >
          返回登录
        </Link>
      </span>
    </div>
  );

  const invitationOnly = access === "blocked" && !setupStatus?.needs_setup;
  if (access !== "allowed" && !invitationOnly) {
    const checking = access === "checking";
    const unavailable = access === "unavailable";
    return (
      <AuthShell
        title={checking ? "正在检查注册状态" : "暂时无法创建账户"}
        subtitle={
          checking
            ? "请稍候，正在确认系统是否允许新用户注册。"
            : unavailable
              ? "暂时无法连接认证服务，请稍后重试。"
              : setupStatus?.needs_setup
                ? "请先完成首个管理员账户初始化。"
                : "当前系统未开放自主注册，请联系平台管理员。"
        }
        footer={footer}
      >
        <div className="space-y-4">
          {!checking && (
            <Button
              type="button"
              className={authPrimaryButtonClassName}
              onClick={() => {
                if (setupStatus?.needs_setup) router.push("/setup");
                else setSetupAttempt((attempt) => attempt + 1);
              }}
            >
              {setupStatus?.needs_setup ? "初始化管理员账户" : "重新检查"}
            </Button>
          )}
          {checking && (
            <p role="status" className="text-sm text-[#667074]">
              正在读取注册配置…
            </p>
          )}
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title={
        invitationMode || invitationOnly
          ? "使用律所邀请码"
          : "创建 Matrix-Law 账户"
      }
      subtitle={
        step === 1
          ? invitationMode || invitationOnly
            ? "输入律所发送到工作邮箱的邀请码，创建账号并加入律所。"
            : "加入组织，开启更高效、更智能的法律工作方式。"
          : step === 2
            ? "提交律所资料，由平台审核后开通独立租户。"
            : "申请已经进入平台审核队列。"
      }
      steps={invitationMode || invitationOnly ? undefined : STEPS}
      activeStep={step}
      footer={footer}
    >
      {step === 1 &&
        (invitationMode || invitationOnly ? (
          <form
            onSubmit={registerWithInvitation}
            className="space-y-5 lg:space-y-8"
          >
            <div className="space-y-2 lg:space-y-3">
              <label
                htmlFor="invitation-email"
                className="text-sm font-semibold"
              >
                工作邮箱
              </label>
              <Input
                id="invitation-email"
                type="email"
                autoComplete="email"
                placeholder="请输入收到邀请的邮箱"
                value={email}
                onChange={(event) => setEmail(event.currentTarget.value)}
                className={authFieldClassName}
                required
              />
            </div>
            <div className="space-y-2 lg:space-y-3">
              <label
                htmlFor="invitation-code"
                className="text-sm font-semibold"
              >
                一次性邀请码
              </label>
              <Input
                id="invitation-code"
                type="text"
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                maxLength={48}
                placeholder="粘贴邮件中的 lmi_ 邀请码"
                value={invitationToken}
                onChange={(event) =>
                  setInvitationToken(event.currentTarget.value)
                }
                className={authFieldClassName}
                required
              />
            </div>
            <div className="space-y-2 lg:space-y-3">
              <label
                htmlFor="invite-password"
                className="text-sm font-semibold"
              >
                设置密码
              </label>
              <div className="relative">
                <Input
                  id="invite-password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="new-password"
                  placeholder="至少 8 位"
                  value={password}
                  onChange={(event) => setPassword(event.currentTarget.value)}
                  className={`${authFieldClassName} pr-12`}
                  minLength={8}
                  required
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
            <div className="space-y-2 lg:space-y-3">
              <label
                htmlFor="invite-password-confirm"
                className="text-sm font-semibold"
              >
                确认密码
              </label>
              <Input
                id="invite-password-confirm"
                type={showPassword ? "text" : "password"}
                autoComplete="new-password"
                placeholder="请再次输入密码"
                value={confirmPassword}
                onChange={(event) =>
                  setConfirmPassword(event.currentTarget.value)
                }
                className={authFieldClassName}
                minLength={8}
                required
              />
            </div>
            <label className="flex cursor-pointer items-start gap-3 text-sm leading-6 text-[#4e595e]">
              <input
                type="checkbox"
                checked={termsAccepted}
                onChange={(event) =>
                  setTermsAccepted(event.currentTarget.checked)
                }
                className="mt-1 size-5 rounded border-[#9ea5a5] accent-[#15523f]"
              />
              <span>
                我已阅读并同意{" "}
                <button
                  type="button"
                  className="text-[#15523f] underline"
                  onClick={() => setLegalDocument("terms")}
                >
                  《Matrix-Law 服务条款》
                </button>
                和{" "}
                <button
                  type="button"
                  className="text-[#15523f] underline"
                  onClick={() => setLegalDocument("privacy")}
                >
                  《隐私政策》
                </button>
              </span>
            </label>
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
                "正在验证邀请码…"
              ) : (
                <>
                  加入律所 <ArrowRightIcon />
                </>
              )}
            </Button>
            {!invitationOnly && (
              <button
                type="button"
                className="w-full text-sm text-[#15523f] underline"
                onClick={() => setInvitationMode(false)}
              >
                返回自主注册
              </button>
            )}
          </form>
        ) : (
          <form onSubmit={registerAccount} className="space-y-5 lg:space-y-8">
            <div className="space-y-2 lg:space-y-3">
              <label htmlFor="register-email" className="text-sm font-semibold">
                工作邮箱
              </label>
              <Input
                id="register-email"
                type="email"
                autoComplete="email"
                placeholder="请输入你的工作邮箱"
                value={email}
                onChange={(event) => setEmail(event.currentTarget.value)}
                className={authFieldClassName}
                required
              />
              <p className="text-xs text-[#82898c]">
                建议使用律师事务所或机构的工作邮箱
              </p>
            </div>

            <div className="space-y-2 lg:space-y-3">
              <label
                htmlFor="register-password"
                className="text-sm font-semibold"
              >
                密码
              </label>
              <div className="relative">
                <Input
                  id="register-password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="new-password"
                  placeholder="请设置密码（至少 8 位）"
                  value={password}
                  onChange={(event) => setPassword(event.currentTarget.value)}
                  className={`${authFieldClassName} pr-12`}
                  minLength={8}
                  required
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

            <div className="space-y-2 lg:space-y-3">
              <label
                htmlFor="register-password-confirm"
                className="text-sm font-semibold"
              >
                确认密码
              </label>
              <Input
                id="register-password-confirm"
                type={showPassword ? "text" : "password"}
                autoComplete="new-password"
                placeholder="请再次输入密码"
                value={confirmPassword}
                onChange={(event) =>
                  setConfirmPassword(event.currentTarget.value)
                }
                className={authFieldClassName}
                minLength={8}
                required
              />
            </div>

            <label className="flex cursor-pointer items-start gap-3 text-sm leading-6 text-[#4e595e]">
              <input
                type="checkbox"
                checked={termsAccepted}
                onChange={(event) =>
                  setTermsAccepted(event.currentTarget.checked)
                }
                className="mt-1 size-5 rounded border-[#9ea5a5] accent-[#15523f]"
              />
              <span>
                我已阅读并同意{" "}
                <button
                  type="button"
                  className="text-[#15523f] underline"
                  onClick={() => setLegalDocument("terms")}
                >
                  《Matrix-Law 服务条款》
                </button>{" "}
                和{" "}
                <button
                  type="button"
                  className="text-[#15523f] underline"
                  onClick={() => setLegalDocument("privacy")}
                >
                  《隐私政策》
                </button>
              </span>
            </label>

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
                "正在创建账户…"
              ) : (
                <>
                  <span>创建账户</span>
                  <ArrowRightIcon />
                </>
              )}
            </Button>
            <button
              type="button"
              className="w-full text-sm text-[#15523f] underline"
              onClick={() => setInvitationMode(true)}
            >
              已收到律所邀请码？使用邀请码加入
            </button>
          </form>
        ))}

      {step === 2 && (
        <form onSubmit={submitOrganization} className="space-y-5">
          <div className="rounded-md border border-[#cad0cd] bg-white/35 p-4 text-sm text-[#596369]">
            <Building2Icon className="mb-2 text-[#15523f]" />
            审核通过后，组织才会成为独立租户；案件、成员和用量都与其他组织隔离。
          </div>
          <div className="space-y-2">
            <label
              htmlFor="organization-name"
              className="text-sm font-semibold"
            >
              组织名称
            </label>
            <Input
              id="organization-name"
              value={organizationName}
              onChange={(event) =>
                setOrganizationName(event.currentTarget.value)
              }
              placeholder="例如：明衡律师事务所"
              className={authFieldClassName}
              required
            />
          </div>
          <div className="space-y-2">
            <label
              htmlFor="organization-slug"
              className="text-sm font-semibold"
            >
              组织标识
            </label>
            <Input
              id="organization-slug"
              value={organizationSlug}
              onChange={(event) => {
                setOrganizationSlug(event.currentTarget.value.toLowerCase());
                setSlugWasEdited(true);
              }}
              placeholder="例如：mingheng-law"
              pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
              className={authFieldClassName}
              required
            />
            <p className="text-xs text-[#82898c]">
              仅限小写字母、数字和连字符，审核通过后用于识别租户。
            </p>
          </div>
          <div className="space-y-2">
            <label htmlFor="display-name" className="text-sm font-semibold">
              你的显示名称（可选）
            </label>
            <Input
              id="display-name"
              value={displayName}
              onChange={(event) => setDisplayName(event.currentTarget.value)}
              placeholder="例如：张律师"
              className={authFieldClassName}
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
            disabled={loading || !organizationName.trim()}
          >
            {loading ? (
              "正在提交申请…"
            ) : (
              <>
                <span>提交律所申请</span>
                <ArrowRightIcon />
              </>
            )}
          </Button>
        </form>
      )}

      {step === 3 && (
        <div className="space-y-5">
          <div className="rounded-md border border-[#b9c9c3] bg-white/40 p-6">
            <ShieldCheckIcon className="size-7 text-[#15523f]" />
            <h2 className="mt-4 text-lg font-semibold">律所注册申请已提交</h2>
            <ul className="mt-4 space-y-3 text-sm leading-6 text-[#596369]">
              <li className="flex gap-3">
                <Building2Icon className="mt-1 size-4 shrink-0 text-[#15523f]" />
                平台运营人员将核验律所资料，审核通过后自动开通租户。
              </li>
              <li className="flex gap-3">
                <UserRoundIcon className="mt-1 size-4 shrink-0 text-[#15523f]" />
                开通后，每次 LLM 调用同时记录租户和实际发起律师。
              </li>
              <li className="flex gap-3">
                <ShieldCheckIcon className="mt-1 size-4 shrink-0 text-[#15523f]" />
                审核意见和开通状态会保存在申请记录中。
              </li>
            </ul>
          </div>
          <p className="border-l-2 border-amber-600 pl-4 text-sm leading-6 text-[#667074]">
            审核期间不会创建案件空间，也不会产生 LLM 用量。
          </p>
          <Button
            type="button"
            className={authPrimaryButtonClassName}
            onClick={() => router.push("/application-status")}
          >
            <span>查看申请状态</span>
            <ArrowRightIcon />
          </Button>
        </div>
      )}

      <Dialog
        open={legalDocument !== null}
        onOpenChange={(open) => {
          if (!open) setLegalDocument(null);
        }}
      >
        <DialogContent className="border-[#c5cac7] bg-[#f7f5ef] text-[#182125]">
          <DialogHeader>
            <DialogTitle>
              {legalDocument === "terms"
                ? "Matrix-Law 服务条款"
                : "Matrix-Law 隐私政策"}
            </DialogTitle>
            <DialogDescription className="space-y-3 pt-3 text-left leading-6 text-[#596369]">
              {legalDocument === "terms" ? (
                <>
                  <span className="block">
                    使用本服务时，请遵守适用法律与组织内部管理要求，并对提交资料的合法性和授权范围负责。
                  </span>
                  <span className="block">
                    AI
                    生成内容用于辅助法律工作，重要结论应由具备资质的人员复核。
                  </span>
                </>
              ) : (
                <>
                  <span className="block">
                    账户、租户、案件和用量数据按授权范围处理。平台管理员默认不查看案件正文、提示词或附件内容。
                  </span>
                  <span className="block">
                    系统仅为提供服务、安全审计和用量核算处理必要数据。
                  </span>
                </>
              )}
            </DialogDescription>
          </DialogHeader>
        </DialogContent>
      </Dialog>
    </AuthShell>
  );
}
