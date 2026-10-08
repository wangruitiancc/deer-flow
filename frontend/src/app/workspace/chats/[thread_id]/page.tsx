import { redirect } from "next/navigation";

import ChatPage from "@/components/workspace/chats/chat-page";
import { LegalThreadGate } from "@/components/workspace/law/legal-thread-gate";

export default async function WorkspaceChatPage({
  params,
}: {
  params: Promise<{ thread_id: string }>;
}) {
  const { thread_id: threadId } = await params;
  if (threadId === "new") {
    redirect("/workspace/law");
  }
  return (
    <LegalThreadGate threadId={threadId}>
      <ChatPage />
    </LegalThreadGate>
  );
}
