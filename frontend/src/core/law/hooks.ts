import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useEffect, useRef } from "react";

import {
  LawRequestError,
  adoptOcrJobResult,
  cancelOcrJob,
  createCitation,
  decideMatterMemoryEntry,
  confirmMatterDeadline,
  rescheduleMatterDeadline,
  transitionMatterDeadline,
  createMatterDeadline,
  createMatter,
  createMatterConversation,
  activateTenant,
  detachMatterConversation,
  getMatterContextByThread,
  getCitation,
  getCurrentOcrDocumentRevision,
  getMatter,
  getCaseWorkbenchOverview,
  openCaseWorkbenchEventStream,
  getCaseWorkbenchDeadlinePage,
  getProjectArtifactSources,
  listWorkProductProposals,
  getWorkProductProposalComparison,
  acceptWorkProductProposal,
  rejectWorkProductProposal,
  listProjectArtifacts,
  listProjectArtifactVersions,
  fetchProjectArtifactContent,
  saveWorkspaceEditorArtifact,
  getMatterLegalHold,
  getOcrPage,
  getOcrPageDraft,
  getOcrProofreadingCollection,
  getOcrProofreadingPublication,
  getOcrResult,
  listCitations,
  listEvidence,
  listEvidenceVersions,
  listMatterMembers,
  listMatters,
  listMatterThreads,
  setMatterLegalHold,
  listMatterMemoryEntries,
  listMatterDeadlineEvents,
  listMatterDeadlineRecipients,
  listMatterDeadlines,
  listMatterNotificationOutbox,
  markMatterNotificationRead,
  listMatterSpeechTranscriptions,
  getMatterSpeechTranscription,
  createMatterSpeechTranscription,
  cancelMatterSpeechTranscription,
  reviewMatterSpeechTranscription,
  listMatterSpeechCitations,
  createMatterSpeechCitation,
  listLegalAuthorities,
  captureLegalAuthority,
  refreshLegalAuthority,
  setLegalAuthorityFavorite,
  reviewLegalAuthorityVersion,
  saveLegalAuthoritySummary,
  listLegalAuthorityVersions,
  readLegalAuthorityVersion,
  listOcrJobs,
  listOcrWorkflows,
  listOcrReviewQueue,
  listTenants,
  getMyTenantCapabilities,
  proposeOcrBlockCorrection,
  rerunOcrJob,
  reviewOcrBlockCorrection,
  reviewOcrBlock,
  reviewOcrPageDraft,
  publishOcrProofreading,
  saveOcrPageDraft,
  scheduleOcrJob,
  planOcrWorkflow,
  transitionOcrWorkflow,
  uploadEvidence,
} from "./api";
import { publishLawMatterAccessRevoked } from "./speech-capture-access-events";
import type {
  CreateCitationInput,
  DecideMatterMemoryInput,
  CreateMatterInput,
  ActivateTenantInput,
  OcrJob,
  OcrPageDraft,
  OcrTableMergeSelection,
  OcrWorkflow,
  PlanOcrWorkflowInput,
  RerunOcrInput,
  MatterThread,
  CaseWorkbenchOverview,
  CaseWorkbenchDeadlinePage,
  MatterLegalHoldView,
  SetMatterLegalHoldInput,
  MatterMemoryCollection,
  MatterMemoryDecisionReceipt,
  MatterDeadline,
  MatterDeadlineEvent,
  MatterDeadlineRecipient,
  MatterNotificationOutboxItem,
  CreateMatterDeadlineInput,
  ConfirmMatterDeadlineInput,
  RescheduleMatterDeadlineInput,
  TransitionMatterDeadlineInput,
  SpeechTranscriptionCollection,
  SpeechTranscriptionDetail,
  ReviewSpeechTranscriptInput,
  SpeechTranscriptCitation,
  CreateSpeechTranscriptCitationInput,
  LegalAuthorityCollection,
  LegalAuthorityVersionSummary,
  LegalAuthorityVersionContent,
  CreateLegalAuthoritySummaryInput,
  CreateLegalAuthorityReviewInput,
  ProposeOcrCorrectionInput,
  ReviewOcrCorrectionInput,
  ScheduleOcrInput,
  UploadEvidenceInput,
  ProjectArtifact,
  ProjectArtifactVersion,
  ProjectArtifactSourceReceipt,
  WorkProductProposal,
  WorkProductProposalComparison,
} from "./types";

const lawKeys = {
  all: ["law"] as const,
  tenants: ["law", "tenants"] as const,
  matters: (tenantId: string) => ["law", "matters", tenantId] as const,
  matter: (tenantId: string, matterId: string) =>
    ["law", "matter", tenantId, matterId] as const,
  caseWorkbench: (tenantId: string, matterId: string) =>
    ["law", "case-workbench", tenantId, matterId] as const,
  caseWorkbenchDeadlines: (
    tenantId: string,
    matterId: string,
    fromAt: string,
    untilAt: string,
  ) =>
    [
      "law",
      "case-workbench-deadlines",
      tenantId,
      matterId,
      fromAt,
      untilAt,
    ] as const,
  projectArtifacts: (tenantId: string, matterId: string) =>
    ["law", "project-artifacts", tenantId, matterId] as const,
  workProductProposals: (tenantId: string, matterId: string) =>
    ["law", "work-product-proposals", tenantId, matterId] as const,
  workProductProposalComparison: (
    tenantId: string,
    matterId: string,
    proposalId: string,
  ) =>
    [
      "law",
      "work-product-proposal-comparison",
      tenantId,
      matterId,
      proposalId,
    ] as const,
  projectArtifactVersions: (
    tenantId: string,
    matterId: string,
    artifactId: string,
  ) =>
    [
      "law",
      "project-artifact-versions",
      tenantId,
      matterId,
      artifactId,
    ] as const,
  projectArtifactContent: (
    tenantId: string,
    matterId: string,
    versionId: string,
  ) =>
    ["law", "project-artifact-content", tenantId, matterId, versionId] as const,
  projectArtifactSources: (
    tenantId: string,
    matterId: string,
    artifactId: string,
    versionId: string,
  ) =>
    [
      "law",
      "project-artifact-sources",
      tenantId,
      matterId,
      artifactId,
      versionId,
    ] as const,
  matterLegalHold: (tenantId: string, matterId: string) =>
    ["law", "matter-legal-hold", tenantId, matterId] as const,
  members: (tenantId: string, matterId: string) =>
    ["law", "matter-members", tenantId, matterId] as const,
  threads: (tenantId: string, matterId: string) =>
    ["law", "matter-threads", tenantId, matterId] as const,
  matterMemory: (tenantId: string, matterId: string) =>
    ["law", "matter-memory", tenantId, matterId] as const,
  matterDeadlines: (tenantId: string, matterId: string) =>
    ["law", "matter-deadlines", tenantId, matterId] as const,
  matterDeadlineRecipients: (tenantId: string, matterId: string) =>
    ["law", "matter-deadline-recipients", tenantId, matterId] as const,
  matterDeadlineEvents: (
    tenantId: string,
    matterId: string,
    deadlineId: string,
  ) =>
    ["law", "matter-deadline-events", tenantId, matterId, deadlineId] as const,
  matterNotificationOutbox: (tenantId: string, matterId: string) =>
    ["law", "matter-notification-outbox", tenantId, matterId] as const,
  speechTranscriptions: (tenantId: string, matterId: string) =>
    ["law", "speech-transcriptions", tenantId, matterId] as const,
  speechTranscription: (tenantId: string, matterId: string, taskId: string) =>
    ["law", "speech-transcription", tenantId, matterId, taskId] as const,
  speechCitations: (tenantId: string, matterId: string, taskId: string) =>
    ["law", "speech-citations", tenantId, matterId, taskId] as const,
  authorities: (tenantId: string, matterId: string) =>
    ["law", "matter-authorities", tenantId, matterId] as const,
  evidence: (tenantId: string, matterId: string) =>
    ["law", "evidence", tenantId, matterId] as const,
  evidenceVersions: (
    tenantId: string,
    matterId: string,
    evidenceItemId: string,
  ) =>
    ["law", "evidence-versions", tenantId, matterId, evidenceItemId] as const,
  ocrJobs: (
    tenantId: string,
    matterId: string,
    evidenceItemId: string,
    evidenceVersionId: string,
  ) =>
    [
      "law",
      "ocr-jobs",
      tenantId,
      matterId,
      evidenceItemId,
      evidenceVersionId,
    ] as const,
  ocrWorkflows: (
    tenantId: string,
    matterId: string,
    evidenceItemId: string,
    evidenceVersionId: string,
  ) =>
    [
      "law",
      "ocr-workflows",
      tenantId,
      matterId,
      evidenceItemId,
      evidenceVersionId,
    ] as const,
  ocrPageDraft: (
    tenantId: string,
    matterId: string,
    evidenceItemId: string,
    evidenceVersionId: string,
    physicalPageNumber: number,
    ocrJobId: string,
  ) =>
    [
      "law",
      "ocr-page-draft",
      tenantId,
      matterId,
      evidenceItemId,
      evidenceVersionId,
      physicalPageNumber,
      ocrJobId,
    ] as const,
  ocrProofreadingPublication: (publicationId: string) =>
    ["law", "ocr-proofreading-publication", publicationId] as const,
  ocrProofreadingCollection: (
    tenantId: string,
    matterId: string,
    evidenceItemId: string,
    evidenceVersionId: string,
  ) =>
    [
      "law",
      "ocr-proofreading-collection",
      tenantId,
      matterId,
      evidenceItemId,
      evidenceVersionId,
    ] as const,
  ocrResult: (ocrJobId: string) => ["law", "ocr-result", ocrJobId] as const,
  ocrPage: (ocrJobId: string, physicalPageNumber: number) =>
    ["law", "ocr-page", ocrJobId, physicalPageNumber] as const,
  citations: (
    tenantId: string,
    matterId: string,
    evidenceItemId: string,
    evidenceVersionId: string,
  ) =>
    [
      "law",
      "citations",
      tenantId,
      matterId,
      evidenceItemId,
      evidenceVersionId,
    ] as const,
  citation: (citationId: string) => ["law", "citation", citationId] as const,
  reviewQueue: (tenantId: string, matterId: string) =>
    ["law", "ocr-review-queue", tenantId, matterId] as const,
  ocrDocumentRevision: (
    tenantId: string,
    matterId: string,
    evidenceItemId: string,
    evidenceVersionId: string,
  ) =>
    [
      "law",
      "ocr-document-revision",
      tenantId,
      matterId,
      evidenceItemId,
      evidenceVersionId,
    ] as const,
  threadContext: (threadId: string) =>
    ["law", "thread-context", threadId] as const,
  myCapabilities: (tenantId: string) =>
    ["law", "my-capabilities", tenantId] as const,
};

function upsertOcrJob(current: OcrJob[] | undefined, job: OcrJob): OcrJob[] {
  if (!current?.length) return [job];
  const existingIndex = current.findIndex((item) => item.id === job.id);
  if (existingIndex === -1) return [job, ...current];
  return current.map((item, index) => (index === existingIndex ? job : item));
}

export function useLawTenants() {
  return useQuery({ queryKey: lawKeys.tenants, queryFn: listTenants });
}

export function useMyTenantCapabilities(tenantId: string | null) {
  return useQuery({
    queryKey: lawKeys.myCapabilities(tenantId ?? ""),
    queryFn: () => getMyTenantCapabilities(tenantId!),
    enabled: Boolean(tenantId),
    retry: false,
  });
}

export function useLawThreadContext(threadId: string | null | undefined) {
  return useQuery({
    queryKey: lawKeys.threadContext(threadId ?? ""),
    queryFn: () => getMatterContextByThread(threadId!),
    enabled: Boolean(threadId),
    retry: false,
  });
}

export function useActivateLawTenant() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: ActivateTenantInput) => activateTenant(input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: lawKeys.tenants });
    },
  });
}

export function useLawMatters(tenantId: string | null) {
  return useQuery({
    queryKey: lawKeys.matters(tenantId ?? ""),
    queryFn: () => listMatters(tenantId!),
    enabled: Boolean(tenantId),
  });
}

export function useCreateLawMatter(tenantId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateMatterInput) => createMatter(tenantId!, input),
    onSuccess: async (matter) => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: lawKeys.matters(matter.tenant_id),
        }),
        queryClient.invalidateQueries({
          queryKey: lawKeys.matter(matter.tenant_id, matter.id),
        }),
      ]);
    },
  });
}

export function useLawMatter(tenantId: string | null, matterId: string | null) {
  return useQuery({
    queryKey: lawKeys.matter(tenantId ?? "", matterId ?? ""),
    queryFn: () => getMatter(tenantId!, matterId!),
    enabled: Boolean(tenantId && matterId),
  });
}

export function useLawCaseWorkbench(
  tenantId: string | null,
  matterId: string | null,
  enabled = true,
) {
  return useQuery<CaseWorkbenchOverview>({
    queryKey: lawKeys.caseWorkbench(tenantId ?? "", matterId ?? ""),
    queryFn: ({ signal }) =>
      getCaseWorkbenchOverview(tenantId!, matterId!, signal),
    enabled: Boolean(tenantId && matterId && enabled),
    retry: false,
    refetchOnWindowFocus: true,
    refetchInterval: () =>
      typeof document !== "undefined" && document.visibilityState === "visible"
        ? 5_000
        : false,
  });
}

export function useLawCaseWorkbenchEvents(
  tenantId: string | null,
  matterId: string | null,
  revision: number | undefined,
) {
  const queryClient = useQueryClient();
  const cursorRef = useRef(0);
  const enabled = revision !== undefined;
  if (revision !== undefined)
    cursorRef.current = Math.max(cursorRef.current, revision);

  useEffect(() => {
    if (!enabled || !tenantId || !matterId || typeof document === "undefined")
      return;
    let active = true;
    let revoked = false;
    let connecting = false;
    let controller: AbortController | undefined;
    let retryTimer: number | undefined;
    let retryDelay = 1_000;

    const invalidateMatterQueries = () =>
      queryClient.invalidateQueries({
        predicate: (query) =>
          query.queryKey[0] === "law" &&
          query.queryKey.includes(tenantId) &&
          query.queryKey.includes(matterId),
      });
    const clearMatterQueries = async () => {
      const predicate = (query: { queryKey: readonly unknown[] }) =>
        query.queryKey[0] === "law" &&
        query.queryKey.includes(tenantId) &&
        query.queryKey.includes(matterId);
      await queryClient.cancelQueries({ predicate });
      queryClient.removeQueries({ predicate });
    };

    const consumeStream = async () => {
      if (!active || connecting || document.visibilityState !== "visible")
        return;
      connecting = true;
      controller = new AbortController();
      try {
        const response = await openCaseWorkbenchEventStream(
          tenantId,
          matterId,
          cursorRef.current,
          controller.signal,
        );
        if (!response.body)
          throw new Error("Case workbench event stream has no body.");
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        while (active && document.visibilityState === "visible") {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let boundary = buffer.indexOf("\n\n");
          while (boundary >= 0) {
            const block = buffer.slice(0, boundary);
            buffer = buffer.slice(boundary + 2);
            let eventName = "message";
            let eventId: number | undefined;
            const dataLines: string[] = [];
            for (const line of block.split("\n")) {
              if (line.startsWith("event:")) eventName = line.slice(6).trim();
              else if (line.startsWith("id:")) {
                const parsed = Number(line.slice(3).trim());
                if (Number.isSafeInteger(parsed) && parsed >= 0)
                  eventId = parsed;
              } else if (line.startsWith("data:"))
                dataLines.push(line.slice(5).trimStart());
            }
            if (eventName === "revoked") {
              revoked = true;
              publishLawMatterAccessRevoked(tenantId, matterId);
              await clearMatterQueries();
              controller.abort();
              return;
            }
            if (eventName === "change") {
              const payload = JSON.parse(dataLines.join("\n")) as {
                revision?: number;
              };
              if (eventId !== undefined)
                cursorRef.current = Math.max(cursorRef.current, eventId);
              else if (Number.isSafeInteger(payload.revision)) {
                cursorRef.current = Math.max(
                  cursorRef.current,
                  payload.revision!,
                );
              }
              void invalidateMatterQueries();
              retryDelay = 1_000;
            }
            boundary = buffer.indexOf("\n\n");
          }
        }
      } catch (error) {
        if (
          error instanceof LawRequestError &&
          (error.status === 403 || error.status === 404)
        ) {
          revoked = true;
          publishLawMatterAccessRevoked(tenantId, matterId);
          await clearMatterQueries();
          return;
        }
        retryDelay = Math.min(retryDelay * 2, 30_000);
        // The existing visible-page query polling remains the recovery path.
      } finally {
        connecting = false;
        if (active && !revoked && document.visibilityState === "visible") {
          retryTimer = window.setTimeout(
            () => void consumeStream(),
            retryDelay,
          );
        }
      }
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        controller?.abort();
        if (retryTimer !== undefined) window.clearTimeout(retryTimer);
      } else {
        void consumeStream();
      }
    };

    document.addEventListener("visibilitychange", onVisibilityChange);
    void consumeStream();
    return () => {
      active = false;
      controller?.abort();
      if (retryTimer !== undefined) window.clearTimeout(retryTimer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [enabled, matterId, queryClient, tenantId]);
}

export function useLawCaseWorkbenchDeadlines(
  tenantId: string | null,
  matterId: string | null,
  fromAt: string,
  untilAt: string,
) {
  return useInfiniteQuery<CaseWorkbenchDeadlinePage>({
    queryKey: lawKeys.caseWorkbenchDeadlines(
      tenantId ?? "",
      matterId ?? "",
      fromAt,
      untilAt,
    ),
    queryFn: ({ pageParam, signal }) =>
      getCaseWorkbenchDeadlinePage(
        tenantId!,
        matterId!,
        { fromAt, untilAt, offset: Number(pageParam) },
        signal,
      ),
    initialPageParam: 0,
    getNextPageParam: (lastPage) => lastPage.next_offset ?? undefined,
    enabled: Boolean(tenantId && matterId),
    retry: false,
    refetchOnWindowFocus: true,
    refetchInterval: () =>
      typeof document !== "undefined" && document.visibilityState === "visible"
        ? 5_000
        : false,
  });
}

export function useLawProjectArtifacts(tenantId: string, matterId: string) {
  return useQuery<ProjectArtifact[]>({
    queryKey: lawKeys.projectArtifacts(tenantId, matterId),
    queryFn: ({ signal }) => listProjectArtifacts(tenantId, matterId, signal),
    enabled: Boolean(tenantId && matterId),
    retry: false,
    refetchOnWindowFocus: true,
    refetchInterval: () =>
      typeof document !== "undefined" && document.visibilityState === "visible"
        ? 5_000
        : false,
  });
}

export function useLawWorkProductProposals(tenantId: string, matterId: string) {
  return useQuery<WorkProductProposal[]>({
    queryKey: lawKeys.workProductProposals(tenantId, matterId),
    queryFn: ({ signal }) =>
      listWorkProductProposals(tenantId, matterId, signal),
    enabled: Boolean(tenantId && matterId),
    retry: false,
    refetchOnWindowFocus: true,
    refetchInterval: () =>
      typeof document !== "undefined" && document.visibilityState === "visible"
        ? 5_000
        : false,
  });
}

export function useLawWorkProductProposalComparison(
  tenantId: string,
  matterId: string,
  proposalId: string | null,
) {
  return useQuery<WorkProductProposalComparison>({
    queryKey: lawKeys.workProductProposalComparison(
      tenantId,
      matterId,
      proposalId ?? "",
    ),
    queryFn: ({ signal }) =>
      getWorkProductProposalComparison(tenantId, matterId, proposalId!, signal),
    enabled: Boolean(tenantId && matterId && proposalId),
    retry: false,
  });
}

export function useAcceptLawWorkProductProposal(
  tenantId: string,
  matterId: string,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: acceptWorkProductProposal,
    onSuccess: async (_receipt, input) =>
      Promise.all([
        queryClient.invalidateQueries({
          queryKey: lawKeys.workProductProposals(tenantId, matterId),
        }),
        queryClient.invalidateQueries({
          queryKey: lawKeys.workProductProposalComparison(
            tenantId,
            matterId,
            input.proposalId,
          ),
        }),
        queryClient.invalidateQueries({
          queryKey: lawKeys.projectArtifacts(tenantId, matterId),
        }),
        queryClient.invalidateQueries({
          queryKey: lawKeys.caseWorkbench(tenantId, matterId),
        }),
      ]),
  });
}

export function useRejectLawWorkProductProposal(
  tenantId: string,
  matterId: string,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: rejectWorkProductProposal,
    onSuccess: async (_receipt, input) =>
      Promise.all([
        queryClient.invalidateQueries({
          queryKey: lawKeys.workProductProposals(tenantId, matterId),
        }),
        queryClient.invalidateQueries({
          queryKey: lawKeys.workProductProposalComparison(
            tenantId,
            matterId,
            input.proposalId,
          ),
        }),
      ]),
  });
}

export function useLawProjectArtifactVersions(
  tenantId: string,
  matterId: string,
  artifactId: string | null,
) {
  return useQuery<ProjectArtifactVersion[]>({
    queryKey: lawKeys.projectArtifactVersions(
      tenantId,
      matterId,
      artifactId ?? "",
    ),
    queryFn: ({ signal }) =>
      listProjectArtifactVersions(tenantId, matterId, artifactId!, signal),
    enabled: Boolean(tenantId && matterId && artifactId),
    retry: false,
  });
}

export function useLawProjectArtifactContent(
  version: ProjectArtifactVersion | null,
) {
  return useQuery<string>({
    queryKey: lawKeys.projectArtifactContent(
      version?.tenant_id ?? "",
      version?.matter_id ?? "",
      version?.id ?? "",
    ),
    queryFn: async ({ signal }) => {
      if (!version) throw new Error("Artifact version is unavailable.");
      return (await fetchProjectArtifactContent(version, signal)).text();
    },
    enabled: Boolean(version),
    retry: false,
  });
}

export function useLawProjectArtifactSources(
  tenantId: string,
  matterId: string,
  artifactId: string | null,
  versionId: string | null,
) {
  return useQuery<ProjectArtifactSourceReceipt>({
    queryKey: lawKeys.projectArtifactSources(
      tenantId,
      matterId,
      artifactId ?? "",
      versionId ?? "",
    ),
    queryFn: ({ signal }) =>
      getProjectArtifactSources(
        tenantId,
        matterId,
        artifactId!,
        versionId!,
        signal,
      ),
    enabled: Boolean(tenantId && matterId && artifactId && versionId),
    retry: false,
  });
}

export function useSaveWorkspaceEditorArtifact(
  tenantId: string,
  matterId: string,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: saveWorkspaceEditorArtifact,
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: lawKeys.projectArtifacts(tenantId, matterId),
        }),
        queryClient.invalidateQueries({
          queryKey: lawKeys.caseWorkbench(tenantId, matterId),
        }),
      ]);
    },
  });
}

export function useLawMatterLegalHold(
  tenantId: string | null,
  matterId: string | null,
) {
  return useQuery<MatterLegalHoldView>({
    queryKey: lawKeys.matterLegalHold(tenantId ?? "", matterId ?? ""),
    queryFn: () => getMatterLegalHold(tenantId!, matterId!),
    enabled: Boolean(tenantId && matterId),
  });
}

export function useSetLawMatterLegalHold(
  tenantId: string | null,
  matterId: string | null,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: SetMatterLegalHoldInput) =>
      setMatterLegalHold(tenantId!, matterId!, input),
    onSuccess: async ({ matter }) => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: lawKeys.matterLegalHold(matter.tenant_id, matter.id),
        }),
        queryClient.invalidateQueries({
          queryKey: lawKeys.matter(matter.tenant_id, matter.id),
        }),
        queryClient.invalidateQueries({
          queryKey: lawKeys.matters(matter.tenant_id),
        }),
      ]);
    },
  });
}

export function useLawMatterMembers(
  tenantId: string | null,
  matterId: string | null,
) {
  return useQuery({
    queryKey: lawKeys.members(tenantId ?? "", matterId ?? ""),
    queryFn: () => listMatterMembers(tenantId!, matterId!),
    enabled: Boolean(tenantId && matterId),
  });
}

export function useLawMatterThreads(
  tenantId: string | null,
  matterId: string | null,
) {
  return useQuery({
    queryKey: lawKeys.threads(tenantId ?? "", matterId ?? ""),
    queryFn: () => listMatterThreads(tenantId!, matterId!),
    select: (mappings) =>
      mappings.filter((mapping) => mapping.status === "active"),
    enabled: Boolean(tenantId && matterId),
  });
}

export function useLawMatterMemory(
  tenantId: string | null,
  matterId: string | null,
) {
  return useQuery<MatterMemoryCollection>({
    queryKey: lawKeys.matterMemory(tenantId ?? "", matterId ?? ""),
    queryFn: () => listMatterMemoryEntries(tenantId!, matterId!),
    enabled: Boolean(tenantId && matterId),
    retry: false,
  });
}

export function useDecideLawMatterMemory(
  tenantId: string | null,
  matterId: string | null,
) {
  const queryClient = useQueryClient();
  const key = lawKeys.matterMemory(tenantId ?? "", matterId ?? "");
  return useMutation<
    MatterMemoryDecisionReceipt,
    Error,
    { entryId: string; input: DecideMatterMemoryInput }
  >({
    mutationFn: ({ entryId, input }) =>
      decideMatterMemoryEntry(tenantId!, matterId!, entryId, input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: key });
    },
  });
}

export function useLawMatterDeadlines(
  tenantId: string | null,
  matterId: string | null,
) {
  return useQuery<MatterDeadline[]>({
    queryKey: lawKeys.matterDeadlines(tenantId ?? "", matterId ?? ""),
    queryFn: ({ signal }) => listMatterDeadlines(tenantId!, matterId!, signal),
    enabled: Boolean(tenantId && matterId),
    retry: false,
  });
}

export function useLawMatterDeadlineRecipients(
  tenantId: string | null,
  matterId: string | null,
  enabled = true,
) {
  return useQuery<MatterDeadlineRecipient[]>({
    queryKey: lawKeys.matterDeadlineRecipients(tenantId ?? "", matterId ?? ""),
    queryFn: ({ signal }) =>
      listMatterDeadlineRecipients(tenantId!, matterId!, signal),
    enabled: Boolean(enabled && tenantId && matterId),
    retry: false,
  });
}

export function useLawMatterDeadlineEvents(
  tenantId: string | null,
  matterId: string | null,
  deadlineId: string | null,
) {
  return useQuery<MatterDeadlineEvent[]>({
    queryKey: lawKeys.matterDeadlineEvents(
      tenantId ?? "",
      matterId ?? "",
      deadlineId ?? "",
    ),
    queryFn: ({ signal }) =>
      listMatterDeadlineEvents(tenantId!, matterId!, deadlineId!, signal),
    enabled: Boolean(tenantId && matterId && deadlineId),
    retry: false,
  });
}

export function useLawMatterNotificationOutbox(
  tenantId: string | null,
  matterId: string | null,
) {
  return useQuery<MatterNotificationOutboxItem[]>({
    queryKey: lawKeys.matterNotificationOutbox(tenantId ?? "", matterId ?? ""),
    queryFn: ({ signal }) =>
      listMatterNotificationOutbox(tenantId!, matterId!, signal),
    enabled: Boolean(tenantId && matterId),
    retry: false,
  });
}

export function useMarkLawMatterNotificationRead(
  tenantId: string | null,
  matterId: string | null,
) {
  const queryClient = useQueryClient();
  return useMutation<MatterNotificationOutboxItem, Error, string>({
    mutationFn: (notificationId) =>
      markMatterNotificationRead(tenantId!, matterId!, notificationId),
    onSuccess: async () =>
      queryClient.invalidateQueries({
        queryKey: lawKeys.matterNotificationOutbox(
          tenantId ?? "",
          matterId ?? "",
        ),
      }),
  });
}

export function useLawSpeechTranscriptions(tenantId: string, matterId: string) {
  return useQuery<SpeechTranscriptionCollection>({
    queryKey: lawKeys.speechTranscriptions(tenantId, matterId),
    queryFn: ({ signal }) =>
      listMatterSpeechTranscriptions(tenantId, matterId, signal),
    retry: false,
    refetchOnWindowFocus: "always",
    refetchOnReconnect: "always",
    refetchIntervalInBackground: false,
    refetchInterval: (query) =>
      query.state.data?.items.some((item) =>
        ["queued", "processing"].includes(item.status),
      )
        ? 3_000
        : false,
  });
}

export function useLawSpeechTranscription(
  tenantId: string,
  matterId: string,
  taskId: string | null,
) {
  return useQuery<SpeechTranscriptionDetail>({
    queryKey: lawKeys.speechTranscription(tenantId, matterId, taskId ?? ""),
    queryFn: ({ signal }) =>
      getMatterSpeechTranscription(tenantId, matterId, taskId!, signal),
    enabled: Boolean(taskId),
    retry: false,
    refetchOnWindowFocus: "always",
    refetchOnReconnect: "always",
    refetchIntervalInBackground: false,
    refetchInterval: (query) =>
      query.state.data &&
      ["queued", "processing"].includes(query.state.data.task.status)
        ? 2_000
        : false,
  });
}

export function useCreateLawSpeechTranscription(
  tenantId: string,
  matterId: string,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      evidenceItemId: string;
      evidenceVersionId: string;
    }) =>
      createMatterSpeechTranscription(
        tenantId,
        matterId,
        input.evidenceItemId,
        input.evidenceVersionId,
      ),
    onSuccess: async () =>
      queryClient.invalidateQueries({
        queryKey: lawKeys.speechTranscriptions(tenantId, matterId),
      }),
  });
}

export function useCancelLawSpeechTranscription(
  tenantId: string,
  matterId: string,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (taskId: string) =>
      cancelMatterSpeechTranscription(tenantId, matterId, taskId),
    onSuccess: async (_task, taskId) =>
      Promise.all([
        queryClient.invalidateQueries({
          queryKey: lawKeys.speechTranscriptions(tenantId, matterId),
        }),
        queryClient.invalidateQueries({
          queryKey: lawKeys.speechTranscription(tenantId, matterId, taskId),
        }),
      ]),
  });
}

export function useReviewLawSpeechTranscription(
  tenantId: string,
  matterId: string,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      taskId,
      input,
    }: {
      taskId: string;
      input: ReviewSpeechTranscriptInput;
    }) => reviewMatterSpeechTranscription(tenantId, matterId, taskId, input),
    onSuccess: async (_receipt, variables) =>
      Promise.all([
        queryClient.invalidateQueries({
          queryKey: lawKeys.speechTranscriptions(tenantId, matterId),
        }),
        queryClient.invalidateQueries({
          queryKey: lawKeys.speechTranscription(
            tenantId,
            matterId,
            variables.taskId,
          ),
        }),
      ]),
  });
}

export function useLawSpeechCitations(
  tenantId: string,
  matterId: string,
  taskId: string | null,
) {
  return useQuery<SpeechTranscriptCitation[]>({
    queryKey: lawKeys.speechCitations(tenantId, matterId, taskId ?? ""),
    queryFn: ({ signal }) => listMatterSpeechCitations(tenantId, matterId, taskId!, signal),
    enabled: Boolean(taskId),
    retry: false,
  });
}

export function useCreateLawSpeechCitation(tenantId: string, matterId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ taskId, input }: { taskId: string; input: CreateSpeechTranscriptCitationInput }) =>
      createMatterSpeechCitation(tenantId, matterId, taskId, input),
    onSuccess: async (_citation, variables) =>
      queryClient.invalidateQueries({
        queryKey: lawKeys.speechCitations(tenantId, matterId, variables.taskId),
      }),
  });
}

export function useCreateLawMatterDeadline(
  tenantId: string | null,
  matterId: string | null,
) {
  const queryClient = useQueryClient();
  const key = lawKeys.matterDeadlines(tenantId ?? "", matterId ?? "");
  return useMutation<MatterDeadline, Error, CreateMatterDeadlineInput>({
    mutationFn: (input) => createMatterDeadline(tenantId!, matterId!, input),
    onSuccess: async () => queryClient.invalidateQueries({ queryKey: key }),
  });
}

export function useConfirmLawMatterDeadline(
  tenantId: string | null,
  matterId: string | null,
) {
  const queryClient = useQueryClient();
  return useMutation<
    MatterDeadline,
    Error,
    { deadlineId: string; input: ConfirmMatterDeadlineInput }
  >({
    mutationFn: ({ deadlineId, input }) =>
      confirmMatterDeadline(tenantId!, matterId!, deadlineId, input),
    onSuccess: async (_deadline, variables) => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: lawKeys.matterDeadlines(tenantId ?? "", matterId ?? ""),
        }),
        queryClient.invalidateQueries({
          queryKey: lawKeys.matterNotificationOutbox(
            tenantId ?? "",
            matterId ?? "",
          ),
        }),
        queryClient.invalidateQueries({
          queryKey: lawKeys.matterDeadlineEvents(
            tenantId ?? "",
            matterId ?? "",
            variables.deadlineId,
          ),
        }),
      ]);
    },
  });
}

function useDeadlineMutationInvalidation(
  tenantId: string | null,
  matterId: string | null,
) {
  const queryClient = useQueryClient();
  return async (deadlineId: string) => {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: lawKeys.matterDeadlines(tenantId ?? "", matterId ?? ""),
      }),
      queryClient.invalidateQueries({
        queryKey: lawKeys.matterNotificationOutbox(
          tenantId ?? "",
          matterId ?? "",
        ),
      }),
      queryClient.invalidateQueries({
        queryKey: lawKeys.matterDeadlineEvents(
          tenantId ?? "",
          matterId ?? "",
          deadlineId,
        ),
      }),
    ]);
  };
}

export function useRescheduleLawMatterDeadline(
  tenantId: string | null,
  matterId: string | null,
) {
  const invalidate = useDeadlineMutationInvalidation(tenantId, matterId);
  return useMutation<
    MatterDeadline,
    Error,
    { deadlineId: string; input: RescheduleMatterDeadlineInput }
  >({
    mutationFn: ({ deadlineId, input }) =>
      rescheduleMatterDeadline(tenantId!, matterId!, deadlineId, input),
    onSuccess: async (_deadline, variables) => invalidate(variables.deadlineId),
  });
}

export function useTransitionLawMatterDeadline(
  tenantId: string | null,
  matterId: string | null,
) {
  const invalidate = useDeadlineMutationInvalidation(tenantId, matterId);
  return useMutation<
    MatterDeadline,
    Error,
    {
      deadlineId: string;
      targetState: "cancelled" | "completed";
      input: TransitionMatterDeadlineInput;
    }
  >({
    mutationFn: ({ deadlineId, targetState, input }) =>
      transitionMatterDeadline(
        tenantId!,
        matterId!,
        deadlineId,
        targetState,
        input,
      ),
    onSuccess: async (_deadline, variables) => invalidate(variables.deadlineId),
  });
}

export function useLawAuthorities(
  tenantId: string | null,
  matterId: string | null,
  query = "",
) {
  return useQuery<LegalAuthorityCollection>({
    queryKey: [...lawKeys.authorities(tenantId ?? "", matterId ?? ""), query],
    queryFn: ({ signal }) =>
      listLegalAuthorities(tenantId!, matterId!, { query, signal }),
    enabled: Boolean(tenantId && matterId),
    retry: false,
  });
}

function useInvalidateMatterAuthorities(
  tenantId: string | null,
  matterId: string | null,
) {
  const queryClient = useQueryClient();
  return async () => {
    if (tenantId && matterId) {
      await queryClient.invalidateQueries({
        queryKey: lawKeys.authorities(tenantId, matterId),
      });
    }
  };
}

export function useCaptureLegalAuthority(
  tenantId: string | null,
  matterId: string | null,
) {
  const invalidate = useInvalidateMatterAuthorities(tenantId, matterId);
  return useMutation({
    mutationFn: (officialUrl: string) =>
      captureLegalAuthority(tenantId!, matterId!, officialUrl),
    onSuccess: invalidate,
  });
}

export function useRefreshLegalAuthority(
  tenantId: string | null,
  matterId: string | null,
) {
  const invalidate = useInvalidateMatterAuthorities(tenantId, matterId);
  return useMutation({
    mutationFn: (documentId: string) =>
      refreshLegalAuthority(tenantId!, matterId!, documentId),
    onSuccess: invalidate,
  });
}

export function useSetLegalAuthorityFavorite(
  tenantId: string | null,
  matterId: string | null,
) {
  const invalidate = useInvalidateMatterAuthorities(tenantId, matterId);
  return useMutation({
    mutationFn: ({
      documentId,
      isFavorite,
    }: {
      documentId: string;
      isFavorite: boolean;
    }) =>
      setLegalAuthorityFavorite(tenantId!, matterId!, documentId, isFavorite),
    onSuccess: invalidate,
  });
}

export function useReviewLegalAuthorityVersion(
  tenantId: string | null,
  matterId: string | null,
) {
  const invalidate = useInvalidateMatterAuthorities(tenantId, matterId);
  return useMutation({
    mutationFn: ({
      documentId,
      versionId,
      input,
    }: {
      documentId: string;
      versionId: string;
      input: CreateLegalAuthorityReviewInput;
    }) =>
      reviewLegalAuthorityVersion(
        tenantId!,
        matterId!,
        documentId,
        versionId,
        input,
      ),
    onSuccess: invalidate,
  });
}

export function useSaveLegalAuthoritySummary(
  tenantId: string | null,
  matterId: string | null,
) {
  const invalidate = useInvalidateMatterAuthorities(tenantId, matterId);
  return useMutation({
    mutationFn: ({
      documentId,
      versionId,
      input,
    }: {
      documentId: string;
      versionId: string;
      input: CreateLegalAuthoritySummaryInput;
    }) =>
      saveLegalAuthoritySummary(
        tenantId!,
        matterId!,
        documentId,
        versionId,
        input,
      ),
    onSuccess: invalidate,
  });
}

export function useLegalAuthorityVersions(
  tenantId: string | null,
  matterId: string | null,
  documentId: string | null,
) {
  return useQuery<LegalAuthorityVersionSummary[]>({
    queryKey: [
      ...lawKeys.authorities(tenantId ?? "", matterId ?? ""),
      documentId,
      "versions",
    ],
    queryFn: ({ signal }) =>
      listLegalAuthorityVersions(tenantId!, matterId!, documentId!, signal),
    enabled: Boolean(tenantId && matterId && documentId),
    retry: false,
  });
}

export function useReadLegalAuthorityVersion(
  tenantId: string | null,
  matterId: string | null,
  documentId: string | null,
  versionId: string | null,
  offset: number,
  enabled: boolean,
) {
  return useQuery<LegalAuthorityVersionContent>({
    queryKey: [
      ...lawKeys.authorities(tenantId ?? "", matterId ?? ""),
      documentId,
      versionId,
      "content",
      offset,
    ],
    queryFn: ({ signal }) =>
      readLegalAuthorityVersion(
        tenantId!,
        matterId!,
        documentId!,
        versionId!,
        offset,
        signal,
      ),
    enabled: Boolean(
      enabled && tenantId && matterId && documentId && versionId,
    ),
    retry: false,
  });
}

export function useCreateMatterConversation(
  tenantId: string | null,
  matterId: string | null,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => createMatterConversation(tenantId!, matterId!),
    onSuccess: async () => {
      if (tenantId && matterId) {
        await queryClient.invalidateQueries({
          queryKey: lawKeys.threads(tenantId, matterId),
        });
      }
    },
  });
}

export function useDetachMatterConversation(
  tenantId: string | null,
  matterId: string | null,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (mapping: Pick<MatterThread, "thread_id" | "version">) =>
      detachMatterConversation(tenantId!, matterId!, mapping),
    onSuccess: async (_, mapping) => {
      queryClient.removeQueries({
        queryKey: lawKeys.threadContext(mapping.thread_id),
        exact: true,
      });
      if (tenantId && matterId) {
        await queryClient.invalidateQueries({
          queryKey: lawKeys.threads(tenantId, matterId),
        });
      }
    },
  });
}

export function useLawEvidence(
  tenantId: string | null,
  matterId: string | null,
) {
  return useQuery({
    queryKey: lawKeys.evidence(tenantId ?? "", matterId ?? ""),
    queryFn: () => listEvidence(tenantId!, matterId!),
    enabled: Boolean(tenantId && matterId),
  });
}

export function useUploadLawEvidence(
  tenantId: string | null,
  matterId: string | null,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UploadEvidenceInput) =>
      uploadEvidence(tenantId!, matterId!, input),
    onSuccess: async () => {
      if (tenantId && matterId) {
        await queryClient.invalidateQueries({
          queryKey: lawKeys.evidence(tenantId, matterId),
        });
      }
    },
  });
}

export function useLawEvidenceVersions(
  tenantId: string | null,
  matterId: string | null,
  evidenceItemId: string | null,
) {
  return useQuery({
    queryKey: lawKeys.evidenceVersions(
      tenantId ?? "",
      matterId ?? "",
      evidenceItemId ?? "",
    ),
    queryFn: () => listEvidenceVersions(tenantId!, matterId!, evidenceItemId!),
    enabled: Boolean(tenantId && matterId && evidenceItemId),
  });
}

export function useLawOcrJobs(
  tenantId: string | null,
  matterId: string | null,
  evidenceItemId: string | null,
  evidenceVersionId: string | null,
) {
  return useQuery({
    queryKey: lawKeys.ocrJobs(
      tenantId ?? "",
      matterId ?? "",
      evidenceItemId ?? "",
      evidenceVersionId ?? "",
    ),
    queryFn: () =>
      listOcrJobs(tenantId!, matterId!, evidenceItemId!, evidenceVersionId!),
    enabled: Boolean(
      tenantId && matterId && evidenceItemId && evidenceVersionId,
    ),
    refetchInterval: (query) =>
      query.state.data?.some(
        (job) => job.status === "queued" || job.status === "processing",
      )
        ? 3000
        : false,
  });
}

export function useLawOcrWorkflows(
  tenantId: string | null,
  matterId: string | null,
  evidenceItemId: string | null,
  evidenceVersionId: string | null,
) {
  return useQuery({
    queryKey: lawKeys.ocrWorkflows(
      tenantId ?? "",
      matterId ?? "",
      evidenceItemId ?? "",
      evidenceVersionId ?? "",
    ),
    queryFn: () =>
      listOcrWorkflows(
        tenantId!,
        matterId!,
        evidenceItemId!,
        evidenceVersionId!,
      ),
    enabled: Boolean(
      tenantId && matterId && evidenceItemId && evidenceVersionId,
    ),
    refetchInterval: (query) =>
      query.state.data?.some(
        (workflow) =>
          ["running", "stopping"].includes(workflow.status) ||
          (workflow.status === "paused" &&
            workflow.segments.some((segment) =>
              ["queued", "processing"].includes(segment.status),
            )),
      )
        ? 2000
        : false,
  });
}

export function usePlanLawOcrWorkflow(
  tenantId: string | null,
  matterId: string | null,
  evidenceItemId: string | null,
  evidenceVersionId: string | null,
) {
  const queryClient = useQueryClient();
  const key = lawKeys.ocrWorkflows(
    tenantId ?? "",
    matterId ?? "",
    evidenceItemId ?? "",
    evidenceVersionId ?? "",
  );
  return useMutation({
    mutationFn: (input: PlanOcrWorkflowInput) =>
      planOcrWorkflow(
        tenantId!,
        matterId!,
        evidenceItemId!,
        evidenceVersionId!,
        input,
      ),
    onSuccess: async (workflow) => {
      queryClient.setQueryData<OcrWorkflow[]>(key, (current) => [
        workflow,
        ...(current ?? []).filter((item) => item.id !== workflow.id),
      ]);
      await queryClient.invalidateQueries({ queryKey: key });
    },
  });
}

export function useTransitionLawOcrWorkflow(
  tenantId: string | null,
  matterId: string | null,
  evidenceItemId: string | null,
  evidenceVersionId: string | null,
) {
  const queryClient = useQueryClient();
  const workflowKey = lawKeys.ocrWorkflows(
    tenantId ?? "",
    matterId ?? "",
    evidenceItemId ?? "",
    evidenceVersionId ?? "",
  );
  const jobsKey = lawKeys.ocrJobs(
    tenantId ?? "",
    matterId ?? "",
    evidenceItemId ?? "",
    evidenceVersionId ?? "",
  );
  return useMutation({
    mutationFn: (input: {
      workflowId: string;
      action: "start" | "pause" | "resume" | "continue-paid" | "cancel";
      expectedVersion: number;
      consent?: { quoteId: string; maxTotalMicrounits: string };
    }) =>
      transitionOcrWorkflow(
        tenantId!,
        matterId!,
        evidenceItemId!,
        evidenceVersionId!,
        input.workflowId,
        input.action,
        input.expectedVersion,
        input.consent,
      ),
    onSuccess: async (workflow) => {
      queryClient.setQueryData<OcrWorkflow[]>(workflowKey, (current) =>
        (current ?? []).map((item) =>
          item.id === workflow.id ? workflow : item,
        ),
      );
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: workflowKey }),
        queryClient.invalidateQueries({ queryKey: jobsKey }),
      ]);
    },
  });
}

export function useLawOcrPageDraft(
  tenantId: string | null,
  matterId: string | null,
  evidenceItemId: string | null,
  evidenceVersionId: string | null,
  physicalPageNumber: number | null,
  ocrJobId: string | null,
) {
  return useQuery({
    queryKey: lawKeys.ocrPageDraft(
      tenantId ?? "",
      matterId ?? "",
      evidenceItemId ?? "",
      evidenceVersionId ?? "",
      physicalPageNumber ?? 0,
      ocrJobId ?? "",
    ),
    queryFn: () =>
      getOcrPageDraft(
        tenantId!,
        matterId!,
        evidenceItemId!,
        evidenceVersionId!,
        physicalPageNumber!,
        ocrJobId!,
      ),
    enabled: Boolean(
      tenantId &&
      matterId &&
      evidenceItemId &&
      evidenceVersionId &&
      physicalPageNumber &&
      ocrJobId,
    ),
  });
}

export function useLawOcrProofreadingCollection(
  tenantId: string | null,
  matterId: string | null,
  evidenceItemId: string | null,
  evidenceVersionId: string | null,
) {
  return useQuery({
    queryKey: lawKeys.ocrProofreadingCollection(
      tenantId ?? "",
      matterId ?? "",
      evidenceItemId ?? "",
      evidenceVersionId ?? "",
    ),
    queryFn: () =>
      getOcrProofreadingCollection(
        tenantId!,
        matterId!,
        evidenceItemId!,
        evidenceVersionId!,
      ),
    enabled: Boolean(
      tenantId && matterId && evidenceItemId && evidenceVersionId,
    ),
  });
}

export function useLawOcrProofreadingPublication(
  tenantId: string | null,
  matterId: string | null,
  evidenceItemId: string | null,
  evidenceVersionId: string | null,
  publicationId: string | null,
) {
  return useQuery({
    queryKey: lawKeys.ocrProofreadingPublication(publicationId ?? ""),
    queryFn: () =>
      getOcrProofreadingPublication(
        tenantId!,
        matterId!,
        evidenceItemId!,
        evidenceVersionId!,
        publicationId!,
      ),
    enabled: Boolean(
      tenantId &&
      matterId &&
      evidenceItemId &&
      evidenceVersionId &&
      publicationId,
    ),
  });
}

export function usePublishLawOcrProofreading(
  tenantId: string | null,
  matterId: string | null,
  evidenceItemId: string | null,
  evidenceVersionId: string | null,
) {
  const queryClient = useQueryClient();
  const key = lawKeys.ocrProofreadingCollection(
    tenantId ?? "",
    matterId ?? "",
    evidenceItemId ?? "",
    evidenceVersionId ?? "",
  );
  return useMutation({
    mutationFn: (input: {
      expectedVersions: Record<number, number>;
      allowPartial: boolean;
      tableMerges?: Array<{
        first: OcrTableMergeSelection;
        second: OcrTableMergeSelection;
        header_row_count?: number;
      }>;
    }) =>
      publishOcrProofreading(
        tenantId!,
        matterId!,
        evidenceItemId!,
        evidenceVersionId!,
        {
          expected_versions: input.expectedVersions,
          allow_partial: input.allowPartial,
          table_merges: input.tableMerges,
        },
      ),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: key });
    },
  });
}

export function useSaveLawOcrPageDraft(
  tenantId: string | null,
  matterId: string | null,
  evidenceItemId: string | null,
  evidenceVersionId: string | null,
  physicalPageNumber: number | null,
  ocrJobId: string | null,
) {
  const queryClient = useQueryClient();
  const key = lawKeys.ocrPageDraft(
    tenantId ?? "",
    matterId ?? "",
    evidenceItemId ?? "",
    evidenceVersionId ?? "",
    physicalPageNumber ?? 0,
    ocrJobId ?? "",
  );
  return useMutation({
    mutationFn: (input: { markdownText: string; expectedVersion: number }) =>
      saveOcrPageDraft(
        tenantId!,
        matterId!,
        evidenceItemId!,
        evidenceVersionId!,
        physicalPageNumber!,
        {
          ocr_job_id: ocrJobId!,
          markdown_text: input.markdownText,
          expected_version: input.expectedVersion,
        },
      ),
    onSuccess: async (draft) => {
      queryClient.setQueryData<OcrPageDraft>(key, draft);
      await queryClient.invalidateQueries({
        queryKey: lawKeys.ocrProofreadingCollection(
          tenantId ?? "",
          matterId ?? "",
          evidenceItemId ?? "",
          evidenceVersionId ?? "",
        ),
      });
    },
  });
}

export function useReviewLawOcrPageDraft(
  tenantId: string | null,
  matterId: string | null,
  evidenceItemId: string | null,
  evidenceVersionId: string | null,
  physicalPageNumber: number | null,
  ocrJobId: string | null,
) {
  const queryClient = useQueryClient();
  const key = lawKeys.ocrPageDraft(
    tenantId ?? "",
    matterId ?? "",
    evidenceItemId ?? "",
    evidenceVersionId ?? "",
    physicalPageNumber ?? 0,
    ocrJobId ?? "",
  );
  return useMutation({
    mutationFn: (expectedVersion: number) =>
      reviewOcrPageDraft(
        tenantId!,
        matterId!,
        evidenceItemId!,
        evidenceVersionId!,
        physicalPageNumber!,
        { ocr_job_id: ocrJobId!, expected_version: expectedVersion },
      ),
    onSuccess: async (draft) => {
      queryClient.setQueryData<OcrPageDraft>(key, draft);
      await queryClient.invalidateQueries({
        queryKey: lawKeys.ocrProofreadingCollection(
          tenantId ?? "",
          matterId ?? "",
          evidenceItemId ?? "",
          evidenceVersionId ?? "",
        ),
      });
    },
  });
}

export function useLawOcrDocumentRevision(
  tenantId: string | null,
  matterId: string | null,
  evidenceItemId: string | null,
  evidenceVersionId: string | null,
) {
  return useQuery({
    queryKey: lawKeys.ocrDocumentRevision(
      tenantId ?? "",
      matterId ?? "",
      evidenceItemId ?? "",
      evidenceVersionId ?? "",
    ),
    queryFn: () =>
      getCurrentOcrDocumentRevision(
        tenantId!,
        matterId!,
        evidenceItemId!,
        evidenceVersionId!,
      ),
    enabled: Boolean(
      tenantId && matterId && evidenceItemId && evidenceVersionId,
    ),
  });
}

export function useAdoptLawOcrResult(
  tenantId: string | null,
  matterId: string | null,
  evidenceItemId: string | null,
  evidenceVersionId: string | null,
) {
  const queryClient = useQueryClient();
  const key = lawKeys.ocrDocumentRevision(
    tenantId ?? "",
    matterId ?? "",
    evidenceItemId ?? "",
    evidenceVersionId ?? "",
  );
  return useMutation({
    mutationFn: (input: { ocrJobId: string; expectedVersion: number }) =>
      adoptOcrJobResult(
        tenantId!,
        matterId!,
        evidenceItemId!,
        evidenceVersionId!,
        input.ocrJobId,
        input.expectedVersion,
      ),
    onSuccess: (revision) => {
      queryClient.setQueryData(key, revision);
    },
  });
}

export function useScheduleLawOcr(
  tenantId: string | null,
  matterId: string | null,
  evidenceItemId: string | null,
  evidenceVersionId: string | null,
) {
  const queryClient = useQueryClient();
  const key = lawKeys.ocrJobs(
    tenantId ?? "",
    matterId ?? "",
    evidenceItemId ?? "",
    evidenceVersionId ?? "",
  );
  return useMutation({
    mutationFn: (input: ScheduleOcrInput) =>
      scheduleOcrJob(
        tenantId!,
        matterId!,
        evidenceItemId!,
        evidenceVersionId!,
        input,
      ),
    onSuccess: async (job) => {
      queryClient.setQueryData<OcrJob[]>(key, (current) =>
        upsertOcrJob(current, job),
      );
      await queryClient.invalidateQueries({ queryKey: key });
    },
  });
}

export function useRerunLawOcr(
  tenantId: string | null,
  matterId: string | null,
  evidenceItemId: string | null,
  evidenceVersionId: string | null,
) {
  const queryClient = useQueryClient();
  const key = lawKeys.ocrJobs(
    tenantId ?? "",
    matterId ?? "",
    evidenceItemId ?? "",
    evidenceVersionId ?? "",
  );
  return useMutation({
    mutationFn: (input: RerunOcrInput) =>
      rerunOcrJob(
        tenantId!,
        matterId!,
        evidenceItemId!,
        evidenceVersionId!,
        input,
      ),
    onSuccess: async (job) => {
      queryClient.setQueryData<OcrJob[]>(key, (current) =>
        upsertOcrJob(current, job),
      );
      await queryClient.invalidateQueries({ queryKey: key });
    },
  });
}

export function useCancelLawOcr(
  tenantId: string | null,
  matterId: string | null,
  evidenceItemId: string | null,
  evidenceVersionId: string | null,
) {
  const queryClient = useQueryClient();
  const key = lawKeys.ocrJobs(
    tenantId ?? "",
    matterId ?? "",
    evidenceItemId ?? "",
    evidenceVersionId ?? "",
  );
  return useMutation({
    mutationFn: (ocrJobId: string) =>
      cancelOcrJob(
        tenantId!,
        matterId!,
        evidenceItemId!,
        evidenceVersionId!,
        ocrJobId,
      ),
    onSuccess: async (job) => {
      queryClient.setQueryData<OcrJob[]>(key, (current) =>
        upsertOcrJob(current, job),
      );
      await queryClient.invalidateQueries({ queryKey: key });
    },
  });
}

export function useLawOcrResult(
  tenantId: string | null,
  matterId: string | null,
  evidenceItemId: string | null,
  evidenceVersionId: string | null,
  ocrJobId: string | null,
  enabled = true,
) {
  return useQuery({
    queryKey: lawKeys.ocrResult(ocrJobId ?? ""),
    queryFn: () =>
      getOcrResult(
        tenantId!,
        matterId!,
        evidenceItemId!,
        evidenceVersionId!,
        ocrJobId!,
      ),
    enabled: Boolean(
      enabled &&
      tenantId &&
      matterId &&
      evidenceItemId &&
      evidenceVersionId &&
      ocrJobId,
    ),
  });
}

export function useLawOcrPage(
  tenantId: string | null,
  matterId: string | null,
  evidenceItemId: string | null,
  evidenceVersionId: string | null,
  ocrJobId: string | null,
  physicalPageNumber: number | null,
) {
  return useQuery({
    queryKey: lawKeys.ocrPage(ocrJobId ?? "", physicalPageNumber ?? 0),
    queryFn: () =>
      getOcrPage(
        tenantId!,
        matterId!,
        evidenceItemId!,
        evidenceVersionId!,
        ocrJobId!,
        physicalPageNumber!,
      ),
    enabled: Boolean(
      tenantId &&
      matterId &&
      evidenceItemId &&
      evidenceVersionId &&
      ocrJobId &&
      physicalPageNumber,
    ),
  });
}

export function useReviewLawOcrBlock(
  tenantId: string | null,
  matterId: string | null,
  evidenceItemId: string | null,
  evidenceVersionId: string | null,
  ocrJobId: string | null,
  physicalPageNumber: number | null,
) {
  const queryClient = useQueryClient();
  const pageKey = lawKeys.ocrPage(ocrJobId ?? "", physicalPageNumber ?? 0);
  return useMutation({
    mutationFn: ({
      blockId,
      decision,
    }: {
      blockId: string;
      decision: "verified" | "rejected";
    }) =>
      reviewOcrBlock(
        tenantId!,
        matterId!,
        evidenceItemId!,
        evidenceVersionId!,
        ocrJobId!,
        physicalPageNumber!,
        blockId,
        decision,
      ),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: pageKey }),
        queryClient.invalidateQueries({
          queryKey: lawKeys.reviewQueue(tenantId ?? "", matterId ?? ""),
        }),
      ]);
    },
  });
}

export function useLawOcrReviewQueue(
  tenantId: string | null,
  matterId: string | null,
) {
  return useQuery({
    queryKey: lawKeys.reviewQueue(tenantId ?? "", matterId ?? ""),
    queryFn: () => listOcrReviewQueue(tenantId!, matterId!),
    enabled: Boolean(tenantId && matterId),
  });
}

export function useProposeLawOcrCorrection(
  tenantId: string | null,
  matterId: string | null,
  evidenceItemId: string | null,
  evidenceVersionId: string | null,
  ocrJobId: string | null,
  physicalPageNumber: number | null,
) {
  const queryClient = useQueryClient();
  const pageKey = lawKeys.ocrPage(ocrJobId ?? "", physicalPageNumber ?? 0);
  return useMutation({
    mutationFn: ({
      blockId,
      input,
    }: {
      blockId: string;
      input: ProposeOcrCorrectionInput;
    }) =>
      proposeOcrBlockCorrection(
        tenantId!,
        matterId!,
        evidenceItemId!,
        evidenceVersionId!,
        ocrJobId!,
        physicalPageNumber!,
        blockId,
        input,
      ),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: pageKey });
    },
  });
}

export function useReviewLawOcrCorrection(
  tenantId: string | null,
  matterId: string | null,
  evidenceItemId: string | null,
  evidenceVersionId: string | null,
  ocrJobId: string | null,
  physicalPageNumber: number | null,
) {
  const queryClient = useQueryClient();
  const pageKey = lawKeys.ocrPage(ocrJobId ?? "", physicalPageNumber ?? 0);
  return useMutation({
    mutationFn: ({
      blockId,
      correctionId,
      input,
    }: {
      blockId: string;
      correctionId: string;
      input: ReviewOcrCorrectionInput;
    }) =>
      reviewOcrBlockCorrection(
        tenantId!,
        matterId!,
        evidenceItemId!,
        evidenceVersionId!,
        ocrJobId!,
        physicalPageNumber!,
        blockId,
        correctionId,
        input,
      ),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: pageKey });
    },
  });
}

export function useLawCitations(
  tenantId: string | null,
  matterId: string | null,
  evidenceItemId: string | null,
  evidenceVersionId: string | null,
) {
  return useQuery({
    queryKey: lawKeys.citations(
      tenantId ?? "",
      matterId ?? "",
      evidenceItemId ?? "",
      evidenceVersionId ?? "",
    ),
    queryFn: () =>
      listCitations(tenantId!, matterId!, evidenceItemId!, evidenceVersionId!),
    enabled: Boolean(
      tenantId && matterId && evidenceItemId && evidenceVersionId,
    ),
  });
}

export function useLawCitation(
  tenantId: string | null,
  matterId: string | null,
  evidenceItemId: string | null,
  evidenceVersionId: string | null,
  citationId: string | null,
) {
  return useQuery({
    queryKey: lawKeys.citation(citationId ?? ""),
    queryFn: () =>
      getCitation(
        tenantId!,
        matterId!,
        evidenceItemId!,
        evidenceVersionId!,
        citationId!,
      ),
    enabled: Boolean(
      tenantId && matterId && evidenceItemId && evidenceVersionId && citationId,
    ),
  });
}

export function useCreateLawCitation(
  tenantId: string | null,
  matterId: string | null,
  evidenceItemId: string | null,
  evidenceVersionId: string | null,
) {
  const queryClient = useQueryClient();
  const key = lawKeys.citations(
    tenantId ?? "",
    matterId ?? "",
    evidenceItemId ?? "",
    evidenceVersionId ?? "",
  );
  return useMutation({
    mutationFn: (input: CreateCitationInput) =>
      createCitation(
        tenantId!,
        matterId!,
        evidenceItemId!,
        evidenceVersionId!,
        input,
      ),
    onSuccess: async (citation) => {
      queryClient.setQueryData(lawKeys.citation(citation.id), citation);
      await queryClient.invalidateQueries({ queryKey: key });
    },
  });
}
