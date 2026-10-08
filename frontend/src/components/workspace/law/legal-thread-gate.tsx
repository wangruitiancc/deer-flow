"use client";

import { LoaderCircleIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";

import { useLawThreadContext } from "@/core/law";

export function LegalThreadGate({
  threadId,
  children,
}: {
  threadId: string;
  children: ReactNode;
}) {
  const router = useRouter();
  const contextQuery = useLawThreadContext(threadId);

  useEffect(() => {
    if (contextQuery.isError) {
      router.replace("/workspace/law");
    }
  }, [contextQuery.isError, router]);

  if (!contextQuery.data) {
    return (
      <div className="text-muted-foreground flex size-full items-center justify-center">
        <LoaderCircleIcon
          className="size-5 animate-spin"
          aria-label="Checking legal work access"
        />
      </div>
    );
  }

  return children;
}
