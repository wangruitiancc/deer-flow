"use client";

import { LoaderCircleIcon, SquarePenIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { toast } from "sonner";

import { useCreateMatterConversation } from "@/core/law";
import { pathOfThread } from "@/core/threads/utils";

// The parent keys this control by tenant and matter so late writes cannot navigate
// a different scope. The existing mutation owns thread creation/binding/cleanup.
export function NewMatterConversationButton({
  tenantId,
  matterId,
  label,
  title,
  onCreated,
}: {
  tenantId: string;
  matterId: string;
  label: string;
  title?: string;
  onCreated?: () => void;
}) {
  const router = useRouter();
  const mutation = useCreateMatterConversation(tenantId, matterId);
  const alive = useRef(true);
  const inFlight = useRef(false);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  return (
    <button
      type="button"
      className="law-new-conversation"
      title={title}
      disabled={mutation.isPending}
      onClick={() => {
        if (inFlight.current) return;
        inFlight.current = true;
        void mutation
          .mutateAsync()
          .then((created) => {
            if (!alive.current) return;
            onCreated?.();
            router.push(pathOfThread(created.threadId));
          })
          .catch((error: unknown) => {
            if (alive.current)
              toast.error(
                error instanceof Error ? error.message : "会话创建失败。",
              );
          })
          .finally(() => {
            inFlight.current = false;
          });
      }}
    >
      {mutation.isPending ? (
        <LoaderCircleIcon className="size-4 animate-spin" />
      ) : (
        <SquarePenIcon className="size-4" strokeWidth={1.6} />
      )}
      <span className="min-w-0 truncate">{label}</span>
    </button>
  );
}
