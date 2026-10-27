"use client";

import Link from "next/link";
import { useEffect } from "react";

import { buildLoginUrl } from "@/core/auth/login-url";

// The server has already denied the workspace. Only navigation runs here;
// protected workspace children are never rendered for an expired session.
export function WorkspaceLoginRedirect() {
  useEffect(() => {
    const { pathname, search, hash } = window.location;
    window.location.replace(buildLoginUrl(`${pathname}${search}${hash}`));
  }, []);

  return (
    <main className="flex min-h-screen items-center justify-center">
      <Link href="/login">正在前往登录…</Link>
    </main>
  );
}
