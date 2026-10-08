"use client";

import {
  ArrowRightIcon,
  Building2Icon,
  CheckCircle2Icon,
  Clock3Icon,
  LogOutIcon,
  RefreshCwIcon,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { useAuth } from "@/core/auth/AuthProvider";
import {
  listMyOnboardingApplications,
  type OnboardingApplication,
} from "@/core/law";

const STATUS_LABEL = {
  submitted: "等待平台审核",
  needs_more_info: "需要补充资料",
  approved: "已审核通过",
  rejected: "未通过",
  provision_failed: "开通处理中",
} as const;

export default function ApplicationStatusPage() {
  const { user, logout } = useAuth();
  const [items, setItems] = useState<OnboardingApplication[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setItems(await listMyOnboardingApplications());
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "无法读取申请状态。");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => void load(), [load]);
  const approved = items.some((item) => item.status === "approved");

  return (
    <main className="min-h-screen bg-[#f6f4ed] text-[#182125]">
      <header className="border-b border-[#d9d9d2] bg-[#f9f8f3]/90 px-6 py-4">
        <div className="mx-auto flex max-w-5xl items-center justify-between">
          <div>
            <p className="font-serif text-xl font-semibold">Matrix-Law</p>
            <p className="mt-0.5 text-xs text-[#788083]">注册申请中心</p>
          </div>
          <Button variant="ghost" size="sm" onClick={() => void logout()}>
            <LogOutIcon />
            退出账号
          </Button>
        </div>
      </header>
      <section className="mx-auto max-w-5xl px-6 py-14">
        <div className="flex flex-col justify-between gap-5 border-b border-[#cfd3d0] pb-8 sm:flex-row sm:items-end">
          <div>
            <p className="text-sm text-[#15523f]">{user?.email}</p>
            <h1 className="mt-2 font-serif text-4xl">注册申请</h1>
            <p className="mt-3 text-sm leading-6 text-[#667074]">
              律所通过平台审核后才会建立租户、成员关系和独立用量边界。
            </p>
          </div>
          <Button
            variant="outline"
            onClick={() => void load()}
            disabled={loading}
          >
            <RefreshCwIcon className={loading ? "animate-spin" : undefined} />
            刷新状态
          </Button>
        </div>

        {error && <p className="mt-8 text-sm text-red-600">{error}</p>}
        <div className="mt-8 space-y-4">
          {!loading && items.length === 0 && (
            <div className="rounded-lg border border-dashed border-[#bfc6c2] bg-white/35 p-10 text-center">
              <Building2Icon className="mx-auto size-8 text-[#15523f]" />
              <p className="mt-4 font-medium">当前没有注册申请</p>
              <Button
                asChild
                className="mt-5 bg-[#15523f] text-white hover:bg-[#123f32]"
              >
                <Link href="/onboarding">继续提交律所资料</Link>
              </Button>
            </div>
          )}
          {items.map((item) => (
            <article
              key={item.id}
              className="rounded-lg border border-[#cfd3d0] bg-white/55 p-6"
            >
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <p className="text-xs tracking-[0.18em] text-[#7b8385]">
                    {item.application_type === "law_firm"
                      ? "律所注册"
                      : "律师注册"}
                  </p>
                  <h2 className="mt-2 text-xl font-semibold">
                    {item.organization_name ?? item.display_name}
                  </h2>
                  <p className="mt-2 text-sm text-[#667074]">
                    申请编号 {item.id.slice(0, 8)} ·{" "}
                    {new Date(item.submitted_at).toLocaleString("zh-CN")}
                  </p>
                </div>
                <span className="inline-flex items-center gap-2 rounded-full border border-[#abc0b7] bg-[#edf3ef] px-3 py-1 text-sm text-[#15523f]">
                  {item.status === "approved" ? (
                    <CheckCircle2Icon className="size-4" />
                  ) : (
                    <Clock3Icon className="size-4" />
                  )}
                  {STATUS_LABEL[item.status]}
                </span>
              </div>
              {item.public_note && (
                <p className="mt-5 border-l-2 border-[#15523f] pl-4 text-sm leading-6 text-[#596369]">
                  {item.public_note}
                </p>
              )}
            </article>
          ))}
        </div>
        {approved && (
          <Button
            asChild
            className="mt-8 bg-[#15523f] text-white hover:bg-[#123f32]"
          >
            <Link href="/workspace/law">
              进入法律工作台
              <ArrowRightIcon />
            </Link>
          </Button>
        )}
      </section>
    </main>
  );
}
