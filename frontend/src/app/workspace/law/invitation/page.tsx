"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  WorkspaceBody,
  WorkspaceContainer,
  WorkspaceHeader,
} from "@/components/workspace/workspace-container";
import {
  acceptTenantMembershipInvitation,
  getOwnTenantMembershipInvitation,
  type Membership,
} from "@/core/law";

export const dynamic = "force-dynamic";

export default function LawMembershipInvitationPage() {
  const searchParams = useSearchParams();
  const tenantId = searchParams.get("tenant_id") ?? "";
  const [membership, setMembership] = useState<Membership | null>(null);
  const [invitationToken, setInvitationToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [accepting, setAccepting] = useState(false);

  useEffect(() => {
    let active = true;
    if (!tenantId) {
      setError("邀请链接缺少律所标识，请向律所管理员索取完整链接。");
      setLoading(false);
      return () => { active = false; };
    }
    setLoading(true);
    getOwnTenantMembershipInvitation(tenantId)
      .then((result) => {
        if (active) {
          setMembership(result);
          setError(null);
        }
      })
      .catch((cause: unknown) => {
        if (active) {
          setError(cause instanceof Error ? cause.message : "当前账号无法读取此邀请。");
          setMembership(null);
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [tenantId]);

  async function acceptInvitation() {
    if (!membership || !tenantId) return;
    setAccepting(true);
    setError(null);
    try {
      await acceptTenantMembershipInvitation(tenantId, membership.id, invitationToken.trim());
      window.location.assign("/workspace/law");
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : "无法接受该律所邀请。");
      setAccepting(false);
    }
  }

  return (
    <WorkspaceContainer>
      <WorkspaceHeader />
      <WorkspaceBody className="overflow-auto">
        <main className="mx-auto w-full max-w-3xl p-5 sm:p-8">
          <p className="text-primary text-sm font-medium">LAW FIRM INVITATION</p>
          <h1 className="mt-2 font-serif text-4xl">接受律所成员邀请</h1>
          <p className="text-muted-foreground mt-3 text-sm leading-6">
            请先使用邀请所绑定的 Matrix-Law 账号登录。接受前不会开放该律所的案件、材料或能力。
          </p>

          <section className="bg-card mt-7 rounded-lg border p-5 sm:p-7">
            {loading ? (
              <p className="text-muted-foreground text-sm">正在核对邀请归属…</p>
            ) : membership ? (
              <>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h2 className="text-xl font-semibold">
                      {membership.display_name ?? "律所成员"}
                    </h2>
                    <p className="text-muted-foreground mt-1 text-sm">
                      律所标识：{tenantId}
                    </p>
                  </div>
                  <Badge variant="outline">
                    {membership.role === "finance" ? "律所财务" : membership.role} · 待接受
                  </Badge>
                </div>
                <p className="text-muted-foreground mt-5 text-sm leading-6">
                  请向律所管理员获取单次邀请码。邀请码只接受一次，且绑定到当前已登录账号。
                  {membership.invitation_expires_at ? ` 有效期至 ${new Date(membership.invitation_expires_at).toLocaleString("zh-CN")}。` : ""}
                </p>
                <label className="mt-5 grid gap-2 text-sm font-medium" htmlFor="membership-invitation-token">
                  单次邀请码
                </label>
                <input
                  id="membership-invitation-token"
                  className="mt-2 h-11 w-full rounded-md border border-border bg-background px-3 font-mono text-sm"
                  autoComplete="off"
                  autoCapitalize="none"
                  spellCheck={false}
                  value={invitationToken}
                  onChange={(event) => setInvitationToken(event.target.value)}
                  placeholder="lmi_…"
                  aria-describedby="membership-invitation-help"
                />
                <p id="membership-invitation-help" className="text-muted-foreground mt-2 text-xs">
                  邀请码由律所管理员单独提供；不要把它放入邀请链接。
                </p>
                <Button className="mt-6" onClick={() => void acceptInvitation()} disabled={accepting || !invitationToken.trim()}>
                  {accepting ? "正在接受…" : "接受邀请"}
                </Button>
              </>
            ) : (
              <p className="text-muted-foreground text-sm leading-6">
                {error ?? "没有找到待接受的邀请。"}
              </p>
            )}
            {error && membership && (
              <p role="alert" className="text-destructive mt-4 text-sm">{error}</p>
            )}
          </section>
          <p className="text-muted-foreground mt-4 text-xs leading-5">
            邀请仅对被登记的用户账号有效。若链接显示不属于你的账号，请联系律所管理员重新核对邀请对象。
          </p>
        </main>
      </WorkspaceBody>
    </WorkspaceContainer>
  );
}
