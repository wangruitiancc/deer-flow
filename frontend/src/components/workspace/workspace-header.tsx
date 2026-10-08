"use client";

import { Building2Icon, GaugeIcon, ScaleIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { MatrixLawLogo, MatrixLawMark } from "@/components/brand/matrix-law-logo";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import { useI18n } from "@/core/i18n/hooks";
import { useLawTenants } from "@/core/law";
import { cn } from "@/lib/utils";

export function WorkspaceHeader({ className }: { className?: string }) {
  const { t } = useI18n();
  const { state } = useSidebar();
  const pathname = usePathname();
  const tenantsQuery = useLawTenants();
  const canManageLawFirm = tenantsQuery.data?.some((item) =>
    ["owner", "admin"].includes(item.membership.role),
  );
  const capabilityActive = pathname.startsWith("/workspace/law/capabilities");
  return (
    <>
      <div
        className={cn(
          "group/workspace-header flex h-12 flex-col justify-center",
          className,
        )}
      >
        {state === "collapsed" ? (
          <div className="group-has-data-[collapsible=icon]/sidebar-wrapper:-translate-y flex w-full cursor-pointer items-center justify-center">
            <div className="group-hover/workspace-header:hidden">
              <MatrixLawMark size={28} />
            </div>
            <SidebarTrigger className="hidden pl-2 group-hover/workspace-header:block" />
          </div>
        ) : (
          <div className="flex items-center justify-between gap-2">
            <Link href="/workspace/law" className="ml-2">
              <MatrixLawLogo
                className="flex items-center gap-2 text-primary font-serif"
                markSize={25}
              />
            </Link>
            <SidebarTrigger />
          </div>
        )}
      </div>
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton
            isActive={
              pathname.startsWith("/workspace/law") &&
              !capabilityActive
            }
            asChild
          >
            <Link className="text-muted-foreground" href="/workspace/law">
              <ScaleIcon size={16} />
              <span>{t.sidebar.lawMatters}</span>
            </Link>
          </SidebarMenuButton>
        </SidebarMenuItem>
        <SidebarMenuItem>
          <SidebarMenuButton isActive={capabilityActive} asChild>
            <Link
              className="text-muted-foreground"
              href="/workspace/law/capabilities"
            >
              <GaugeIcon size={16} />
              <span>我的能力与用量</span>
            </Link>
          </SidebarMenuButton>
        </SidebarMenuItem>
        {canManageLawFirm && (
          <SidebarMenuItem>
            <SidebarMenuButton asChild>
              <Link
                className="text-muted-foreground"
                href="/law-admin/"
              >
                <Building2Icon size={16} />
                <span>律所管理后台</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        )}
      </SidebarMenu>
    </>
  );
}
