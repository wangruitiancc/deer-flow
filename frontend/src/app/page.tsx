import { redirect } from "next/navigation";

import { getAuthenticatedHomePath } from "@/core/auth/role-routing";
import { getServerSideUser } from "@/core/auth/server";

export const dynamic = "force-dynamic";

export default async function LandingPage() {
  const result = await getServerSideUser();
  if (result.tag === "system_setup_required" || result.tag === "needs_setup") {
    redirect("/setup");
  }
  if (result.tag === "authenticated") {
    redirect(getAuthenticatedHomePath(result.user));
  }
  if (result.tag === "config_error") throw new Error(result.message);
  redirect(result.tag === "gateway_unavailable" ? "/workspace/law" : "/login");
}
