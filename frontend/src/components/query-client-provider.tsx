"use client";

import {
  QueryClient,
  QueryClientProvider as TanStackQueryClientProvider,
} from "@tanstack/react-query";
import { useEffect } from "react";

import { registerAuthSessionCleanup } from "@/core/auth/session-lifecycle";

const queryClient = new QueryClient();

export function QueryClientProvider({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  useEffect(
    () =>
      registerAuthSessionCleanup(async () => {
        await queryClient.cancelQueries();
        queryClient.clear();
      }),
    [],
  );

  return (
    <TanStackQueryClientProvider client={queryClient}>
      {children}
    </TanStackQueryClientProvider>
  );
}
