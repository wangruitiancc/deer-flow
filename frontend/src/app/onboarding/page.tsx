"use client";

import {
  ArrowRightIcon,
  Building2Icon,
  UserRoundCheckIcon,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import {
  AuthShell,
  authFieldClassName,
  authPrimaryButtonClassName,
} from "@/components/auth/auth-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  listMyOnboardingApplications,
  submitOnboardingApplication,
} from "@/core/law";

const STEPS = [{ label: "账号" }, { label: "身份" }, { label: "进入工作台" }];

export default function OnboardingPage() {
  const router = useRouter();
  const [applicationType, setApplicationType] = useState<"law_firm" | "lawyer">(
    "law_firm",
  );
  const [displayName, setDisplayName] = useState("");
  const [licenseNumber, setLicenseNumber] = useState("");
  const [targetTenantId, setTargetTenantId] = useState("");
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    void listMyOnboardingApplications()
      .then((items) => {
        if (
          items.some((item) =>
            [
              "submitted",
              "needs_more_info",
              "approved",
              "provision_failed",
            ].includes(item.status),
          )
        ) {
          router.replace("/application-status");
        }
      })
      .catch((reason) =>
        setError(
          reason instanceof Error ? reason.message : "无法检查申请状态。",
        ),
      )
      .finally(() => setChecking(false));
  }, [router]);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setLoading(true);
    try {
      if (applicationType === "law_firm") {
        window.location.assign("/law-admin/");
        return;
      }
      await submitOnboardingApplication({
        application_type: applicationType,
        display_name: displayName.trim() || undefined,
        license_number:
          applicationType === "lawyer" ? licenseNumber.trim() : undefined,
        target_tenant_id:
          applicationType === "lawyer" ? targetTenantId.trim() : undefined,
      });
      router.replace("/application-status");
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "提交申请失败，请稍后重试。",
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell
      title={
        applicationType === "law_firm" ? "激活已审核律所" : "提交律师注册申请"
      }
      subtitle={
        applicationType === "law_firm"
          ? "律所资料由能力平台审核；注册、激活和能力服务器身份校验统一在律所管理端完成。"
          : "申请只会提交给目标律所管理员审核。"
      }
      steps={STEPS}
      activeStep={2}
    >
      <form onSubmit={submit} className="space-y-5">
        <div className="grid grid-cols-2 gap-2 rounded-md border border-[#cad0cd] bg-white/25 p-1.5">
          <button
            type="button"
            onClick={() => setApplicationType("law_firm")}
            className={`rounded px-3 py-2 text-sm ${applicationType === "law_firm" ? "bg-[#15523f] text-white" : "text-[#596369]"}`}
          >
            注册律所
          </button>
          <button
            type="button"
            onClick={() => setApplicationType("lawyer")}
            className={`rounded px-3 py-2 text-sm ${applicationType === "lawyer" ? "bg-[#15523f] text-white" : "text-[#596369]"}`}
          >
            加入律所
          </button>
        </div>
        <div className="rounded-md border border-[#cad0cd] bg-white/35 p-4 text-sm leading-6 text-[#596369]">
          {applicationType === "law_firm" ? (
            <Building2Icon className="mb-2 text-[#15523f]" />
          ) : (
            <UserRoundCheckIcon className="mb-2 text-[#15523f]" />
          )}
          {applicationType === "law_firm"
            ? "请前往律所管理端，使用能力平台签发的激活码完成注册；后续能力服务器登录也在该界面校验。"
            : "律师资料进入目标律所的审核队列。平台管理员不会处理本所律师申请。"}
        </div>
        {applicationType === "lawyer" && <div className="space-y-2">
          <label
            htmlFor="onboarding-display-name"
            className="text-sm font-semibold"
          >
            律师姓名
          </label>
          <Input
            id="onboarding-display-name"
            value={displayName}
            onChange={(event) => setDisplayName(event.currentTarget.value)}
            placeholder="例如：张律师"
            className={authFieldClassName}
            required
          />
        </div>}
        {applicationType === "lawyer" && (
          <>
            <div className="space-y-2">
              <label
                htmlFor="onboarding-license"
                className="text-sm font-semibold"
              >
                律师执业证号
              </label>
              <Input
                id="onboarding-license"
                value={licenseNumber}
                onChange={(event) =>
                  setLicenseNumber(event.currentTarget.value)
                }
                placeholder="请输入律师执业证号"
                className={authFieldClassName}
                required
              />
            </div>
            <div className="space-y-2">
              <label
                htmlFor="onboarding-target-tenant"
                className="text-sm font-semibold"
              >
                律所租户 ID
              </label>
              <Input
                id="onboarding-target-tenant"
                value={targetTenantId}
                onChange={(event) =>
                  setTargetTenantId(event.currentTarget.value)
                }
                placeholder="由律所管理员提供"
                className={authFieldClassName}
                required
              />
              <p className="text-xs text-[#82898c]">
                该标识决定申请进入哪一家律所，审核人只能看到本所申请。
              </p>
            </div>
          </>
        )}
        {error && (
          <p role="alert" className="text-sm text-red-600">
            {error}
          </p>
        )}
        <Button
          type="submit"
          className={authPrimaryButtonClassName}
          disabled={
            checking ||
            loading ||
            (applicationType === "lawyer" &&
              (!displayName.trim() ||
                !licenseNumber.trim() ||
                !targetTenantId.trim()))
          }
        >
          <span>
            {checking
              ? "正在检查…"
              : loading
                ? "正在提交…"
                : applicationType === "law_firm"
                  ? "进入律所管理端"
                  : "提交律师申请"}
          </span>
          <ArrowRightIcon />
        </Button>
      </form>
    </AuthShell>
  );
}
