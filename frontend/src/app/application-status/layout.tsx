import "@/styles/globals.css";
import { redirect } from "next/navigation";

import { AuthProvider } from "@/core/auth/AuthProvider";
import { getServerSideUser } from "@/core/auth/server";
import { I18nProvider } from "@/core/i18n/context";
import { detectLocaleServer } from "@/core/i18n/server";

export const dynamic = "force-dynamic";

export default async function ApplicationStatusLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const locale = await detectLocaleServer();
  const result = await getServerSideUser();
  if (result.tag === "system_setup_required" || result.tag === "needs_setup")
    redirect("/setup");
  if (result.tag !== "authenticated") redirect("/login");
  if (result.user.system_role === "admin") redirect("/admin");
  return (
    <I18nProvider initialLocale={locale}>
      <AuthProvider initialUser={result.user}>{children}</AuthProvider>
    </I18nProvider>
  );
}
