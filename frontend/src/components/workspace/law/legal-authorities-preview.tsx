"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";

import { useLawThreadContext } from "@/core/law";
import {
  LEGAL_AUTHORITIES_ERROR,
  parseLegalAuthorities,
  type LegalAuthorities,
} from "@/core/law/legal-authorities";

const Viewer = dynamic(
  () =>
    import("./legal-authorities-viewer").then(
      (module) => module.LegalAuthoritiesViewer,
    ),
  {
    ssr: false,
    loading: () => (
      <p role="status" className="p-4">
        正在加载法律依据视图…
      </p>
    ),
  },
);

export function LegalAuthoritiesPreview({
  content,
  threadId,
  scope,
  onChange,
}: {
  content: string;
  threadId?: string;
  scope?: { tenant_id: string; matter_id: string };
  onChange?: (document: LegalAuthorities) => void;
}) {
  const context = useLawThreadContext(threadId ?? null);
  const [parsed, setParsed] = useState<{
    content: string;
    document?: LegalAuthorities;
    error?: string;
  }>();
  useEffect(() => {
    let alive = true;
    void parseLegalAuthorities(content).then(
      (document) => {
        if (alive) setParsed({ content, document });
      },
      () => {
        if (alive) setParsed({ content, error: LEGAL_AUTHORITIES_ERROR });
      },
    );
    return () => {
      alive = false;
    };
  }, [content]);
  // Never flash a previous file/draft while asynchronous source hashes are being checked.
  if (parsed?.content !== content)
    return (
      <p role="status" className="p-4">
        正在检查法律依据格式与来源摘要…
      </p>
    );
  if (!parsed.document)
    return (
      <p role="alert" className="p-4 text-sm">
        {parsed.error}
      </p>
    );
  const resolvedScope =
    scope ?? (context.isError ? undefined : (context.data ?? undefined));
  return (
    <Viewer
      key={`${threadId ?? "snapshot"}:${resolvedScope?.tenant_id ?? "unresolved"}:${resolvedScope?.matter_id ?? "unresolved"}`}
      document={parsed.document}
      scope={resolvedScope}
      onChange={onChange}
    />
  );
}
