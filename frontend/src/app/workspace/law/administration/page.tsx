"use client";

/* eslint-disable @next/next/no-html-link-for-pages -- /law-admin/ is served by Nginx outside the Next router. */

import { useEffect } from "react";

export default function LawFirmAdministrationRedirectPage() {
  useEffect(() => {
    window.location.replace("/law-admin/");
  }, []);

  return (
    <main className="grid min-h-screen place-items-center bg-[#f4f5f1] px-6 text-center">
      <div>
        <p className="font-serif text-2xl text-[#17372e]">
          正在进入律所管理后台
        </p>
        <p className="mt-3 text-sm text-[#66706b]">
          律所管理已从 Matrix-Law 律师工作台中分离。
        </p>
        <a
          className="mt-6 inline-block text-sm font-medium text-[#15523f] underline underline-offset-4"
          href="/law-admin/"
        >
          如果没有自动跳转，请点击这里
        </a>
      </div>
    </main>
  );
}
