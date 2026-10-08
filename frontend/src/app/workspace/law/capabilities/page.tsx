"use client";

import { GaugeIcon, ShieldCheckIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import {
  WorkspaceBody,
  WorkspaceContainer,
  WorkspaceHeader,
} from "@/components/workspace/workspace-container";
import {
  useLawTenants,
  useMyTenantCapabilities,
  type TenantListItem,
} from "@/core/law";

function TenantCapabilityCard({ item }: { item: TenantListItem }) {
  const capabilitiesQuery = useMyTenantCapabilities(item.tenant.id);
  const view = capabilitiesQuery.data;
  const statusLabel =
    view?.status === "connected"
      ? "已连接"
      : view?.status === "degraded"
        ? "读取未完成"
        : "待下发";

  return (
    <article className="bg-card rounded-lg border p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="font-medium">{item.tenant.name}</h3>
          <p className="text-muted-foreground mt-1 text-xs">
            成员身份：{item.membership.role} · 状态：{item.membership.status}
          </p>
        </div>
        <Badge variant="outline">{statusLabel}</Badge>
      </div>
      {capabilitiesQuery.isPending ? (
        <p className="text-muted-foreground mt-3 text-sm">
          正在读取本人能力与内部额度…
        </p>
      ) : capabilitiesQuery.isError ? (
        <p className="text-muted-foreground mt-3 text-sm">
          当前无法读取本人能力与内部额度；不会将此视为零额度或无授权。
        </p>
      ) : (
        <>
          <p className="text-muted-foreground mt-3 text-sm leading-6">
            {view?.message ?? "能力快照尚未下发。"}
          </p>
          {view?.snapshot && (
            <p className="text-muted-foreground mt-2 text-xs">
              已授权能力：
              {
                view.snapshot.capabilities.filter(
                  (entry) => entry.decision === "allow",
                ).length
              }{" "}
              项 · 策略版本：{view.snapshot.policy_revision ?? "未提供"}
            </p>
          )}
          {view?.subaccounts && (
            <p className="text-muted-foreground mt-2 text-xs">
              内部子账户：{view.subaccounts.length}{" "}
              个；仅显示本人归属，不构成个人平台账单。
            </p>
          )}
          {view?.usage && (
            <p className="text-muted-foreground mt-2 text-xs">
              已读取 {view.usage.length} 条本人归属用量记录。
            </p>
          )}
        </>
      )}
    </article>
  );
}

/** Lawyer-facing read surface. It intentionally has no management actions or provider data. */
export default function MyLawCapabilitiesPage() {
  const tenantsQuery = useLawTenants();

  return (
    <WorkspaceContainer>
      <WorkspaceHeader />
      <WorkspaceBody className="overflow-auto">
        <main className="mx-auto w-full max-w-4xl p-5 sm:p-8">
          <p className="text-primary text-sm font-medium">MY CAPABILITY VIEW</p>
          <h1 className="mt-2 font-serif text-4xl">我的能力与用量</h1>
          <p className="text-muted-foreground mt-3 max-w-2xl text-sm leading-6">
            这里只显示当前律师在所属律所内获授权的能力快照、个人归属用量和内部额度状态。它不是平台账单，不显示平台成本、供应商信息、其他律所或其他成员的数据。
          </p>

          <section className="bg-card mt-7 rounded-lg border p-5">
            <div className="flex items-center gap-2">
              <ShieldCheckIcon className="text-primary size-5" />
              <h2 className="font-semibold">安全边界</h2>
            </div>
            <p className="text-muted-foreground mt-2 text-sm leading-6">
              模型、MCP 与 Skill
              均由核心能力服务器提供。律师不能添加外部连接、提供 API Key 或 Base
              URL，也不能调整其他成员的能力和额度。
            </p>
          </section>

          <section className="mt-7">
            <div className="flex items-center gap-2">
              <GaugeIcon className="text-primary size-5" />
              <h2 className="text-xl font-semibold">律所范围</h2>
            </div>
            {tenantsQuery.isPending && (
              <p className="text-muted-foreground mt-4 text-sm">
                正在读取所属律所…
              </p>
            )}
            {!tenantsQuery.isPending &&
              (tenantsQuery.data?.length ?? 0) === 0 && (
                <p className="text-muted-foreground mt-4 rounded-lg border border-dashed p-6 text-sm">
                  当前没有可查看的律所成员关系。
                </p>
              )}
            <div className="mt-4 space-y-3">
              {(tenantsQuery.data ?? []).map((item) => (
                <TenantCapabilityCard key={item.tenant.id} item={item} />
              ))}
            </div>
          </section>
        </main>
      </WorkspaceBody>
    </WorkspaceContainer>
  );
}
