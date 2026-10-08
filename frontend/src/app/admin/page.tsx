"use client";

import {
  ActivityIcon,
  BadgeCheckIcon,
  BookOpenCheckIcon,
  Building2Icon,
  CircleDollarSignIcon,
  GaugeIcon,
  KeyRoundIcon,
  LogOutIcon,
  RefreshCwIcon,
  RouteIcon,
  ShieldCheckIcon,
  UsersIcon,
  type LucideIcon,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { getCsrfHeaders } from "@/core/api/fetcher";
import { useAuth } from "@/core/auth/AuthProvider";
import { parseAuthError } from "@/core/auth/types";
import {
  getPlatformOnboardingOverview,
  listPlatformOnboardingApplications,
  reviewPlatformOnboardingApplication,
  type OnboardingApplication,
  type PlatformOnboardingOverview,
} from "@/core/law";

type ReviewDecision = "approved" | "rejected" | "needs_more_info";

const STATUS_LABEL = {
  submitted: "待审核",
  needs_more_info: "待补资料",
  approved: "已通过",
  rejected: "已拒绝",
  provision_failed: "开通失败",
} as const;

const NAV_ITEMS: ReadonlyArray<{
  label: string;
  icon: LucideIcon;
  active?: boolean;
  planned?: boolean;
}> = [
  { label: "运营总览", icon: GaugeIcon, active: true },
  { label: "律所审核", icon: Building2Icon },
  { label: "租户与成员", icon: UsersIcon },
  { label: "模型路由", icon: RouteIcon, planned: true },
  { label: "计量与账本", icon: CircleDollarSignIcon, planned: true },
  { label: "审计中心", icon: BookOpenCheckIcon, planned: true },
];

function Metric({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: number;
  icon: typeof GaugeIcon;
}) {
  return (
    <div className="rounded-lg border border-[#d2d6d2] bg-white/60 p-5">
      <div className="flex items-center justify-between text-sm text-[#687174]">
        <span>{label}</span>
        <Icon className="size-5 text-[#15523f]" />
      </div>
      <p className="mt-5 text-3xl font-semibold tabular-nums">{value}</p>
    </div>
  );
}

export default function PlatformAdminPage() {
  const { user, logout } = useAuth();
  const [overview, setOverview] = useState<PlatformOnboardingOverview | null>(
    null,
  );
  const [applications, setApplications] = useState<OnboardingApplication[]>([]);
  const [selected, setSelected] = useState<OnboardingApplication | null>(null);
  const [publicNote, setPublicNote] = useState("");
  const [internalNote, setInternalNote] = useState("");
  const [loading, setLoading] = useState(true);
  const [reviewing, setReviewing] = useState(false);
  const [error, setError] = useState("");
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordMessage, setPasswordMessage] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [changingPassword, setChangingPassword] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [nextOverview, nextApplications] = await Promise.all([
        getPlatformOnboardingOverview(),
        listPlatformOnboardingApplications({ application_type: "law_firm" }),
      ]);
      setOverview(nextOverview);
      setApplications(nextApplications);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "无法读取运营数据。");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => void load(), [load]);

  const decide = async (decision: ReviewDecision) => {
    if (!selected) return;
    setReviewing(true);
    setError("");
    try {
      await reviewPlatformOnboardingApplication(selected.id, {
        decision,
        public_note: publicNote.trim() || undefined,
        internal_note: internalNote.trim() || undefined,
        expected_version: selected.version,
      });
      setSelected(null);
      setPublicNote("");
      setInternalNote("");
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "审核失败，请重试。");
    } finally {
      setReviewing(false);
    }
  };

  const changePassword = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setPasswordError("");
    setPasswordMessage("");
    if (newPassword.length < 8) {
      setPasswordError("新密码至少需要 8 位字符。");
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError("两次输入的新密码不一致。");
      return;
    }
    setChangingPassword(true);
    try {
      const response = await fetch("/api/v1/auth/change-password", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...getCsrfHeaders(),
        },
        credentials: "include",
        body: JSON.stringify({
          current_password: currentPassword,
          new_password: newPassword,
        }),
      });
      if (!response.ok) {
        setPasswordError(parseAuthError(await response.json()).message);
        return;
      }
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setPasswordMessage("密码已修改，当前登录状态继续有效。");
    } catch {
      setPasswordError("无法连接服务器，请稍后重试。");
    } finally {
      setChangingPassword(false);
    }
  };

  return (
    <main className="flex min-h-screen bg-[#f5f3ed] text-[#182125]">
      <aside className="hidden w-64 shrink-0 border-r border-[#294c40] bg-[#123f32] text-white lg:flex lg:flex-col">
        <div className="border-b border-white/10 px-6 py-7">
          <p className="font-serif text-2xl">Matrix-Law</p>
          <p className="mt-1 text-xs tracking-[0.2em] text-white/55">
            平台运营控制台
          </p>
        </div>
        <nav className="flex-1 space-y-1 px-3 py-6">
          {NAV_ITEMS.map(({ label, icon: Icon, active, planned }) => (
            <button
              key={label}
              type="button"
              disabled={!active}
              className={`flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left text-sm ${active ? "bg-white/12 text-white" : "text-white/58"}`}
            >
              <Icon className="size-4" />
              <span>{label}</span>
              {planned && (
                <span className="ml-auto text-[10px] text-white/40">
                  规划中
                </span>
              )}
            </button>
          ))}
        </nav>
        <div className="border-t border-white/10 p-4 text-xs text-white/55">
          平台角色：平台管理员
          <br />
          <span className="mt-1 block truncate">{user?.email}</span>
        </div>
      </aside>

      <div className="min-w-0 flex-1">
        <header className="flex h-16 items-center justify-between border-b border-[#d4d7d3] bg-[#faf9f5]/90 px-5 sm:px-8">
          <div className="flex items-center gap-3">
            <ShieldCheckIcon className="size-5 text-[#15523f]" />
            <span className="text-sm font-semibold">平台运营</span>
            <Badge
              variant="outline"
              className="border-[#a9bbb4] text-[#15523f]"
            >
              数据面隔离
            </Badge>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setPasswordMessage("");
                setPasswordError("");
                setPasswordOpen(true);
              }}
            >
              <KeyRoundIcon />
              修改密码
            </Button>
            <Button variant="ghost" size="sm" onClick={() => void logout()}>
              <LogOutIcon />
              退出
            </Button>
          </div>
        </header>

        <div className="mx-auto max-w-7xl px-5 py-8 sm:px-8">
          <div className="flex flex-col justify-between gap-5 border-b border-[#d0d4d0] pb-7 sm:flex-row sm:items-end">
            <div>
              <p className="text-sm font-medium text-[#15523f]">
                CONTROL PLANE
              </p>
              <h1 className="mt-2 font-serif text-4xl">运营总览</h1>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-[#667074]">
                审核组织与律师身份，控制租户开通。平台运营视图不展示案件正文、附件或提示词。
              </p>
            </div>
            <Button
              variant="outline"
              onClick={() => void load()}
              disabled={loading}
            >
              <RefreshCwIcon className={loading ? "animate-spin" : undefined} />
              刷新
            </Button>
          </div>

          {error && (
            <p
              role="alert"
              className="mt-5 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
            >
              {error}
            </p>
          )}

          <section className="mt-7 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Metric
              label="待审律所"
              value={overview?.pending_law_firms ?? 0}
              icon={Building2Icon}
            />
            <Metric
              label="待补律所资料"
              value={overview?.needs_more_info ?? 0}
              icon={BadgeCheckIcon}
            />
            <Metric
              label="活跃租户"
              value={overview?.active_tenants ?? 0}
              icon={ActivityIcon}
            />
            <Metric
              label="活跃成员"
              value={overview?.active_memberships ?? 0}
              icon={UsersIcon}
            />
          </section>

          <section className="mt-10">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <h2 className="text-xl font-semibold">注册审核队列</h2>
                <p className="mt-1 text-sm text-[#71797b]">
                  审核通过会在同一事务中创建租户或激活律师成员关系。
                </p>
              </div>
              <Badge variant="outline" className="border-[#b4c2bc]">
                平台仅审核律所
              </Badge>
            </div>

            <div className="mt-4 overflow-hidden rounded-lg border border-[#ced2ce] bg-white/55">
              <div className="hidden grid-cols-[1.4fr_1fr_0.8fr_0.7fr] gap-4 border-b border-[#d7dad7] bg-[#eeece6] px-5 py-3 text-xs font-medium text-[#687174] md:grid">
                <span>申请主体</span>
                <span>申请人</span>
                <span>状态</span>
                <span className="text-right">操作</span>
              </div>
              {!loading && applications.length === 0 && (
                <p className="px-5 py-12 text-center text-sm text-[#788083]">
                  当前筛选条件下没有申请。
                </p>
              )}
              {applications.map((item) => (
                <article
                  key={item.id}
                  className="grid gap-3 border-b border-[#e0e2df] px-5 py-4 last:border-0 md:grid-cols-[1.4fr_1fr_0.8fr_0.7fr] md:items-center"
                >
                  <div>
                    <p className="font-medium">
                      {item.organization_name ?? item.display_name}
                    </p>
                    <p className="mt-1 text-xs text-[#7b8385]">
                      租户标识：{item.desired_slug}
                    </p>
                  </div>
                  <p
                    className="truncate text-sm text-[#596369]"
                    title={item.applicant_user_id}
                  >
                    {item.applicant_user_id}
                  </p>
                  <Badge
                    variant="outline"
                    className="w-fit border-[#b4c2bc] text-[#15523f]"
                  >
                    {STATUS_LABEL[item.status]}
                  </Badge>
                  <div className="md:text-right">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={
                        !(
                          [
                            "submitted",
                            "needs_more_info",
                            "provision_failed",
                          ] as string[]
                        ).includes(item.status)
                      }
                      onClick={() => {
                        setSelected(item);
                        setPublicNote(item.public_note ?? "");
                        setInternalNote(item.internal_note ?? "");
                      }}
                    >
                      查看审核
                    </Button>
                  </div>
                </article>
              ))}
            </div>
          </section>
        </div>
      </div>

      <Dialog
        open={selected !== null}
        onOpenChange={(open) => {
          if (!open) setSelected(null);
        }}
      >
        <DialogContent className="max-w-xl border-[#c8ceca] bg-[#f7f5ef]">
          <DialogHeader>
            <DialogTitle className="font-serif text-2xl">
              审核注册申请
            </DialogTitle>
            <DialogDescription>
              外部意见会向申请人展示；内部备注仅平台运营人员可见。
            </DialogDescription>
          </DialogHeader>
          {selected && (
            <div className="space-y-5">
              <dl className="grid grid-cols-[7rem_1fr] gap-y-2 rounded-md border border-[#d4d7d3] bg-white/45 p-4 text-sm">
                <dt className="text-[#788083]">申请类型</dt>
                <dd>律所注册</dd>
                <dt className="text-[#788083]">主体名称</dt>
                <dd>{selected.organization_name ?? selected.display_name}</dd>
                <dt className="text-[#788083]">申请人 ID</dt>
                <dd className="break-all">{selected.applicant_user_id}</dd>
              </dl>
              <div>
                <label className="text-sm font-medium">给申请人的意见</label>
                <Textarea
                  className="mt-2 min-h-24 border-[#c6ccc8] bg-white/55"
                  value={publicNote}
                  onChange={(e) => setPublicNote(e.currentTarget.value)}
                />
              </div>
              <div>
                <label className="text-sm font-medium">内部审核备注</label>
                <Textarea
                  className="mt-2 min-h-20 border-[#c6ccc8] bg-white/55"
                  value={internalNote}
                  onChange={(e) => setInternalNote(e.currentTarget.value)}
                />
              </div>
              <div className="flex flex-wrap justify-end gap-2 border-t border-[#d7dad7] pt-4">
                <Button
                  variant="outline"
                  disabled={reviewing}
                  onClick={() => void decide("needs_more_info")}
                >
                  要求补充资料
                </Button>
                <Button
                  variant="outline"
                  className="border-red-300 text-red-700 hover:bg-red-50"
                  disabled={reviewing || !publicNote.trim()}
                  onClick={() => void decide("rejected")}
                >
                  拒绝
                </Button>
                <Button
                  className="bg-[#15523f] text-white hover:bg-[#123f32]"
                  disabled={reviewing}
                  onClick={() => void decide("approved")}
                >
                  {reviewing ? "正在处理…" : "审核通过并开通"}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={passwordOpen} onOpenChange={setPasswordOpen}>
        <DialogContent className="max-w-md border-[#c8ceca] bg-[#f7f5ef]">
          <DialogHeader>
            <DialogTitle className="font-serif text-2xl">
              修改管理员密码
            </DialogTitle>
            <DialogDescription>
              修改后其他已登录会话会失效，当前会话会自动续签。
            </DialogDescription>
          </DialogHeader>
          <form className="space-y-4" onSubmit={changePassword}>
            <Input
              type="password"
              autoComplete="current-password"
              placeholder="当前密码"
              value={currentPassword}
              onChange={(event) =>
                setCurrentPassword(event.currentTarget.value)
              }
              required
            />
            <Input
              type="password"
              autoComplete="new-password"
              placeholder="新密码（至少 8 位）"
              value={newPassword}
              onChange={(event) => setNewPassword(event.currentTarget.value)}
              minLength={8}
              required
            />
            <Input
              type="password"
              autoComplete="new-password"
              placeholder="再次输入新密码"
              value={confirmPassword}
              onChange={(event) =>
                setConfirmPassword(event.currentTarget.value)
              }
              minLength={8}
              required
            />
            {passwordError && (
              <p role="alert" className="text-sm text-red-600">
                {passwordError}
              </p>
            )}
            {passwordMessage && (
              <p role="status" className="text-sm text-[#15523f]">
                {passwordMessage}
              </p>
            )}
            <div className="flex justify-end gap-2 border-t border-[#d7dad7] pt-4">
              <Button
                type="button"
                variant="outline"
                onClick={() => setPasswordOpen(false)}
              >
                关闭
              </Button>
              <Button
                type="submit"
                className="bg-[#15523f] text-white hover:bg-[#123f32]"
                disabled={changingPassword}
              >
                {changingPassword ? "正在修改…" : "确认修改"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </main>
  );
}
