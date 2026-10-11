import { fetch as fetchWithAuth } from "@/core/api/fetcher";
import { getBackendBaseURL } from "@/core/config";

import type {
  CreateMatterInput,
  CreatedMatterConversation,
  CreateCitationInput,
  DecideMatterMemoryInput,
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
  SpeechTranscriptionTask,
  SpeechTranscriptCitation,
  SpeechCaptureAudioTrackSettings,
  SpeechCaptureCreateReceipt,
  SpeechCaptureChunkReceipt,
  SpeechCaptureFinishReceipt,
  SpeechCaptureSession,
  SpeechCaptureChunkReceiptPage,
  SpeechCapturePreviewReceipt,
  ReviewSpeechTranscriptInput,
  ReviewSpeechTranscriptReceipt,
  CreateSpeechTranscriptCitationInput,
  LegalAuthorityCollection,
  LegalAuthorityVersionSummary,
  LegalAuthorityVersionContent,
  CreateLegalAuthorityReviewInput,
  CreateLegalAuthoritySummaryInput,
  LegalAuthoritySummary,
  LegalAuthorityReview,
  LegalAuthorityCaptureReceipt,
  ActivateTenantInput,
  RegisterLawFirmInput,
  LawFirmRegistrationReceipt,
  EvidenceItem,
  EvidenceVersion,
  Matter,
  CaseWorkbenchOverview,
  CaseWorkbenchDeadlinePage,
  MatterLegalHoldView,
  MatterLegalHoldEvent,
  SetMatterLegalHoldInput,
  MatterMember,
  MatterThread,
  Membership,
  OcrCitation,
  OcrDocumentRevisionState,
  OcrBlockCorrection,
  OcrBlockReview,
  OcrFormulaOpinion,
  OcrTableOpinion,
  OcrReviewQueueEntry,
  OcrJob,
  OcrWorkflow,
  OcrWorkflowEvent,
  OcrPageDraft,
  OcrProofreadingCollection,
  OcrProofreadingPublication,
  OcrTableMergeSelection,
  RerunOcrInput,
  OcrPage,
  OcrResult,
  OcrUserSettings,
  PersonalMineruCredential,
  OnboardingApplication,
  OnboardingApplicationStatus,
  OnboardingApplicationType,
  PlatformOnboardingOverview,
  TenantAdministrationOverview,
  TenantCapabilitySubaccountUpdateInput,
  TenantCapabilityMemberAssignmentUpdateInput,
  TenantAuditEvent,
  CapabilityConnectionView,
  UpdateOcrUserSettingsInput,
  ScheduleOcrInput,
  PlanOcrWorkflowInput,
  ProposeOcrCorrectionInput,
  ReviewOcrCorrectionInput,
  Tenant,
  TenantListItem,
  TrustedMatterContext,
  UploadEvidenceInput,
  ProjectArtifact,
  ProjectArtifactReview,
  ProjectArtifactReviewDecision,
  ProjectArtifactVersion,
  ProjectArtifactSourceReceipt,
  ProjectArtifactKind,
  ProjectArtifactExportFormat,
  WorkProductProposal,
  WorkProductProposalComparison,
} from "./types";

interface LawEnvelope<T> {
  data: T;
  meta: {
    request_id: string;
    idempotent_replay?: boolean;
  };
}

interface LawErrorBody {
  error?: {
    code?: string;
    message?: string;
  };
  detail?: string;
}

export class LawRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = "LawRequestError";
  }
}

function lawUrl(path: string): string {
  return `${getBackendBaseURL()}/api/law${path}`;
}

async function readError(response: Response, fallback: string) {
  try {
    const body = (await response.json()) as LawErrorBody;
    return {
      message: body.error?.message ?? body.detail ?? fallback,
      code: body.error?.code,
    };
  } catch {
    return { message: fallback, code: undefined };
  }
}

async function requestLaw<T>(
  path: string,
  init: RequestInit | undefined,
  fallback: string,
): Promise<T> {
  const response = await fetchWithAuth(lawUrl(path), init);
  if (!response.ok) {
    const error = await readError(response, fallback);
    throw new LawRequestError(error.message, response.status, error.code);
  }
  const body = (await response.json()) as LawEnvelope<T>;
  return body.data;
}

function jsonRequest(
  method: "POST" | "PATCH" | "PUT",
  body: unknown,
): RequestInit {
  return {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

function idempotencyRequest(body: unknown): RequestInit {
  return {
    ...jsonRequest("POST", body),
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": globalThis.crypto.randomUUID(),
    },
  };
}

function idempotencyHeaders(): HeadersInit {
  return { "Idempotency-Key": globalThis.crypto.randomUUID() };
}

function matterEvidencePath(tenantId: string, matterId: string): string {
  return `/tenants/${encodeURIComponent(tenantId)}/matters/${encodeURIComponent(matterId)}/evidence`;
}

function evidenceVersionPath(
  tenantId: string,
  matterId: string,
  evidenceItemId: string,
  evidenceVersionId: string,
): string {
  return `${matterEvidencePath(tenantId, matterId)}/${encodeURIComponent(evidenceItemId)}/versions/${encodeURIComponent(evidenceVersionId)}`;
}

export async function sha256Hex(file: Blob): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    await file.arrayBuffer(),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

export async function listTenants(): Promise<TenantListItem[]> {
  const data = await requestLaw<{ items: TenantListItem[] }>(
    "/tenants",
    undefined,
    "Failed to load legal workspaces.",
  );
  return data.items;
}

export async function submitOnboardingApplication(input: {
  application_type: OnboardingApplicationType;
  organization_name?: string;
  desired_slug?: string;
  display_name?: string;
  license_number?: string;
  target_tenant_id?: string;
}): Promise<OnboardingApplication> {
  const data = await requestLaw<{ application: OnboardingApplication }>(
    "/onboarding/applications",
    jsonRequest("POST", input),
    "无法提交注册申请。",
  );
  return data.application;
}

export async function listMyOnboardingApplications(): Promise<
  OnboardingApplication[]
> {
  const data = await requestLaw<{ items: OnboardingApplication[] }>(
    "/onboarding/applications/me",
    { cache: "no-store" },
    "无法读取注册申请。",
  );
  return data.items;
}

export async function getPlatformOnboardingOverview(): Promise<PlatformOnboardingOverview> {
  return requestLaw<PlatformOnboardingOverview>(
    "/platform/onboarding/overview",
    { cache: "no-store" },
    "无法读取平台概览。",
  );
}

export async function listPlatformOnboardingApplications(input?: {
  application_type?: OnboardingApplicationType;
  status?: OnboardingApplicationStatus;
}): Promise<OnboardingApplication[]> {
  const query = new URLSearchParams();
  if (input?.application_type)
    query.set("application_type", input.application_type);
  if (input?.status) query.set("status", input.status);
  const suffix = query.size ? `?${query.toString()}` : "";
  const data = await requestLaw<{ items: OnboardingApplication[] }>(
    `/platform/onboarding/applications${suffix}`,
    { cache: "no-store" },
    "无法读取审核队列。",
  );
  return data.items;
}

export async function reviewPlatformOnboardingApplication(
  applicationId: string,
  input: {
    decision: "approved" | "rejected" | "needs_more_info";
    public_note?: string;
    internal_note?: string;
    expected_version: number;
  },
): Promise<OnboardingApplication> {
  const data = await requestLaw<{ application: OnboardingApplication }>(
    `/platform/onboarding/applications/${encodeURIComponent(applicationId)}/review`,
    jsonRequest("POST", input),
    "无法完成审核。",
  );
  return data.application;
}

export async function getTenantAdministrationOverview(
  tenantId: string,
): Promise<TenantAdministrationOverview> {
  return requestLaw<TenantAdministrationOverview>(
    `/tenants/${encodeURIComponent(tenantId)}/administration/overview`,
    { cache: "no-store" },
    "无法读取律所管理概览。",
  );
}

export async function listTenantMemberships(
  tenantId: string,
): Promise<Membership[]> {
  const data = await requestLaw<{ items: Membership[] }>(
    `/tenants/${encodeURIComponent(tenantId)}/memberships`,
    { cache: "no-store" },
    "无法读取律所成员。",
  );
  return data.items;
}

export async function getOwnTenantMembershipInvitation(
  tenantId: string,
): Promise<Membership> {
  const data = await requestLaw<{ membership: Membership }>(
    `/tenants/${encodeURIComponent(tenantId)}/memberships/invitation`,
    { cache: "no-store" },
    "无法读取该律所邀请。",
  );
  return data.membership;
}

export async function acceptTenantMembershipInvitation(
  tenantId: string,
  membershipId: string,
  invitationToken: string,
): Promise<Membership> {
  const data = await requestLaw<{ membership: Membership }>(
    `/tenants/${encodeURIComponent(tenantId)}/memberships/${encodeURIComponent(membershipId)}/accept`,
    jsonRequest("POST", { invitation_token: invitationToken }),
    "无法接受该律所邀请。",
  );
  return data.membership;
}

export async function getTenantCapabilityAdministration(
  tenantId: string,
): Promise<CapabilityConnectionView> {
  return requestLaw<CapabilityConnectionView>(
    `/tenants/${encodeURIComponent(tenantId)}/administration/capabilities`,
    { cache: "no-store" },
    "无法读取核心能力服务器连接状态。",
  );
}

export async function updateTenantCapabilitySubaccount(
  tenantId: string,
  membershipId: string,
  input: TenantCapabilitySubaccountUpdateInput,
): Promise<CapabilityConnectionView> {
  return requestLaw<CapabilityConnectionView>(
    `/tenants/${encodeURIComponent(tenantId)}/administration/capabilities/subaccounts/${encodeURIComponent(membershipId)}`,
    jsonRequest("PUT", input),
    "无法更新律所内部额度。",
  );
}

export async function denyTenantMemberCapabilityAssignment(
  tenantId: string,
  membershipId: string,
  input: TenantCapabilityMemberAssignmentUpdateInput,
): Promise<CapabilityConnectionView> {
  return requestLaw<CapabilityConnectionView>(
    `/tenants/${encodeURIComponent(tenantId)}/administration/capabilities/members/${encodeURIComponent(membershipId)}/assignments`,
    jsonRequest("PUT", input),
    "无法撤销成员能力。",
  );
}

export async function getMyTenantCapabilities(
  tenantId: string,
): Promise<CapabilityConnectionView> {
  return requestLaw<CapabilityConnectionView>(
    `/tenants/${encodeURIComponent(tenantId)}/capabilities/me`,
    { cache: "no-store" },
    "无法读取我的能力与用量。",
  );
}

export async function listTenantLawyerApplications(
  tenantId: string,
): Promise<OnboardingApplication[]> {
  const data = await requestLaw<{ items: OnboardingApplication[] }>(
    `/tenants/${encodeURIComponent(tenantId)}/administration/lawyer-applications`,
    { cache: "no-store" },
    "无法读取律师申请。",
  );
  return data.items;
}

export async function reviewTenantLawyerApplication(
  tenantId: string,
  applicationId: string,
  input: {
    decision: "approved" | "rejected" | "needs_more_info";
    public_note?: string;
    internal_note?: string;
    expected_version: number;
  },
): Promise<OnboardingApplication> {
  const data = await requestLaw<{ application: OnboardingApplication }>(
    `/tenants/${encodeURIComponent(tenantId)}/administration/lawyer-applications/${encodeURIComponent(applicationId)}/review`,
    jsonRequest("POST", input),
    "无法完成律师审核。",
  );
  return data.application;
}

export async function listTenantAuditEvents(
  tenantId: string,
): Promise<TenantAuditEvent[]> {
  const data = await requestLaw<{ items: TenantAuditEvent[] }>(
    `/tenants/${encodeURIComponent(tenantId)}/administration/audit`,
    { cache: "no-store" },
    "无法读取律所审计记录。",
  );
  return data.items;
}

export async function getOcrUserSettings(): Promise<OcrUserSettings> {
  return requestLaw<OcrUserSettings>(
    "/ocr-settings",
    { cache: "no-store" },
    "Failed to load OCR settings.",
  );
}

export async function getPersonalMineruCredential(
  tenantId: string,
): Promise<PersonalMineruCredential> {
  return requestLaw<PersonalMineruCredential>(
    `/tenants/${encodeURIComponent(tenantId)}/me/mineru-personal-credential`,
    { cache: "no-store" },
    "无法读取个人 MinerU 凭证状态。",
  );
}

export async function updatePersonalMineruCredential(
  tenantId: string,
  input: { expected_version: number; api_key?: string; revoke?: boolean },
): Promise<PersonalMineruCredential> {
  return requestLaw<PersonalMineruCredential>(
    `/tenants/${encodeURIComponent(tenantId)}/me/mineru-personal-credential`,
    jsonRequest("PUT", input),
    "无法保存个人 MinerU 凭证。",
  );
}

export async function testPersonalMineruCredential(
  tenantId: string,
): Promise<PersonalMineruCredential> {
  return requestLaw<PersonalMineruCredential>(
    `/tenants/${encodeURIComponent(tenantId)}/me/mineru-personal-credential/test`,
    jsonRequest("POST", {}),
    "无法测试个人 MinerU 凭证。",
  );
}

export async function updateOcrUserSettings(
  input: UpdateOcrUserSettingsInput,
): Promise<OcrUserSettings> {
  return requestLaw<OcrUserSettings>(
    "/ocr-settings",
    jsonRequest("PATCH", input),
    "Failed to update OCR settings.",
  );
}

function projectArtifactPath(tenantId: string, matterId: string): string {
  return `/tenants/${encodeURIComponent(tenantId)}/matters/${encodeURIComponent(matterId)}/project-artifacts`;
}

function workProductProposalPath(tenantId: string, matterId: string): string {
  return `/tenants/${encodeURIComponent(tenantId)}/matters/${encodeURIComponent(matterId)}/work-product-proposals`;
}

export async function listWorkProductProposals(
  tenantId: string,
  matterId: string,
  signal?: AbortSignal,
): Promise<WorkProductProposal[]> {
  const data = await requestLaw<{ items: WorkProductProposal[] }>(
    workProductProposalPath(tenantId, matterId),
    { signal, cache: "no-store" },
    "无法读取 AI 候选建议。",
  );
  return data.items;
}

export async function getWorkProductProposalComparison(
  tenantId: string,
  matterId: string,
  proposalId: string,
  signal?: AbortSignal,
): Promise<WorkProductProposalComparison> {
  return requestLaw<WorkProductProposalComparison>(
    `${workProductProposalPath(tenantId, matterId)}/${encodeURIComponent(proposalId)}/comparison`,
    { signal, cache: "no-store" },
    "无法读取候选差异。",
  );
}

export async function acceptWorkProductProposal(input: {
  tenantId: string;
  matterId: string;
  proposalId: string;
  proposalVersion: number;
  selectedChangeIds: string[];
  decisionNote?: string;
  idempotencyKey: string;
}): Promise<{
  proposal: WorkProductProposal;
  artifact: ProjectArtifact;
  artifact_version: ProjectArtifactVersion;
}> {
  return requestLaw(
    `${workProductProposalPath(input.tenantId, input.matterId)}/${encodeURIComponent(input.proposalId)}/accept`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": input.idempotencyKey,
      },
      body: JSON.stringify({
        proposal_version: input.proposalVersion,
        selected_change_ids: input.selectedChangeIds,
        decision_note: input.decisionNote,
      }),
    },
    "无法采纳所选候选变更。",
  );
}

export async function rejectWorkProductProposal(input: {
  tenantId: string;
  matterId: string;
  proposalId: string;
  proposalVersion: number;
  decisionNote?: string;
  idempotencyKey: string;
}): Promise<{ proposal: WorkProductProposal }> {
  return requestLaw(
    `${workProductProposalPath(input.tenantId, input.matterId)}/${encodeURIComponent(input.proposalId)}/reject`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": input.idempotencyKey,
      },
      body: JSON.stringify({
        proposal_version: input.proposalVersion,
        decision_note: input.decisionNote,
      }),
    },
    "无法拒绝候选建议。",
  );
}

export async function listProjectArtifacts(
  tenantId: string,
  matterId: string,
  signal?: AbortSignal,
) {
  const data = await requestLaw<{ items: ProjectArtifact[] }>(
    projectArtifactPath(tenantId, matterId),
    { signal, cache: "no-store" },
    "无法加载项目成果。",
  );
  return data.items;
}

export async function listProjectArtifactVersions(
  tenantId: string,
  matterId: string,
  artifactId: string,
  signal?: AbortSignal,
) {
  const data = await requestLaw<{ items: ProjectArtifactVersion[] }>(
    `${projectArtifactPath(tenantId, matterId)}/${encodeURIComponent(artifactId)}/versions`,
    { signal, cache: "no-store" },
    "无法加载成果版本。",
  );
  return data.items;
}

export async function getProjectArtifactSources(
  tenantId: string,
  matterId: string,
  artifactId: string,
  versionId: string,
  signal?: AbortSignal,
): Promise<ProjectArtifactSourceReceipt> {
  return requestLaw<ProjectArtifactSourceReceipt>(
    `${projectArtifactPath(tenantId, matterId)}/${encodeURIComponent(artifactId)}/versions/${encodeURIComponent(versionId)}/sources`,
    signal ? { signal, cache: "no-store" } : { cache: "no-store" },
    "无法读取该成果版本的来源回执。",
  );
}

export async function listProjectArtifactReviews(
  tenantId: string,
  matterId: string,
  artifactId: string,
  versionId: string,
  signal?: AbortSignal,
) {
  const data = await requestLaw<{ items: ProjectArtifactReview[] }>(
    `${projectArtifactPath(tenantId, matterId)}/${encodeURIComponent(artifactId)}/versions/${encodeURIComponent(versionId)}/reviews`,
    { signal, cache: "no-store" },
    "无法加载律师审核记录。",
  );
  return data.items;
}

export async function reviewProjectArtifactVersion(input: {
  tenantId: string;
  matterId: string;
  artifactId: string;
  versionId: string;
  decision: ProjectArtifactReviewDecision;
  reviewNote: string;
  idempotencyKey: string;
}): Promise<{
  review: ProjectArtifactReview;
  review_status: "reviewed" | "approved";
}> {
  return requestLaw(
    `${projectArtifactPath(input.tenantId, input.matterId)}/${encodeURIComponent(input.artifactId)}/versions/${encodeURIComponent(input.versionId)}/reviews`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": input.idempotencyKey,
      },
      body: JSON.stringify({
        decision: input.decision,
        review_note: input.reviewNote,
      }),
    },
    "无法保存版本审核记录。",
  );
}

export async function saveProjectArtifact(input: {
  tenantId: string;
  matterId: string;
  threadId: string;
  filepath: string;
  file: File;
  sha256: string;
  title: string;
  kind: ProjectArtifactKind;
  artifactId?: string;
  expectedVersion?: number;
  derivedFromVersionId?: string;
  templateId?: string;
  templateSha256?: string;
  idempotencyKey: string;
  signal?: AbortSignal;
}): Promise<{
  artifact: ProjectArtifact;
  artifact_version: ProjectArtifactVersion;
}> {
  const body = new FormData();
  body.set("file", input.file);
  body.set("title", input.title);
  body.set("kind", input.kind);
  body.set("byte_size", String(input.file.size));
  body.set("source_thread_id", input.threadId);
  body.set("source_artifact_path", input.filepath);
  body.set("source_revision_sha256", input.sha256);
  if (input.artifactId !== undefined)
    body.set("project_artifact_id", input.artifactId);
  if (input.expectedVersion !== undefined)
    body.set("expected_version", String(input.expectedVersion));
  if (input.derivedFromVersionId !== undefined)
    body.set("derived_from_version_id", input.derivedFromVersionId);
  if (input.templateId !== undefined) body.set("template_id", input.templateId);
  if (input.templateSha256 !== undefined)
    body.set("template_sha256", input.templateSha256);
  return requestLaw(
    projectArtifactPath(input.tenantId, input.matterId),
    {
      method: "POST",
      body,
      signal: input.signal,
      headers: {
        "Idempotency-Key": input.idempotencyKey,
        "X-Content-SHA256": input.sha256,
      },
    },
    "无法保存项目成果。",
  );
}

export async function saveWorkspaceEditorArtifact(input: {
  tenantId: string;
  matterId: string;
  content: string;
  title: string;
  kind: "case_analysis" | "litigation_strategy";
  artifactId?: string;
  expectedVersion?: number;
  derivedFromVersionId?: string;
  idempotencyKey: string;
  signal?: AbortSignal;
}): Promise<{
  artifact: ProjectArtifact;
  artifact_version: ProjectArtifactVersion;
}> {
  const file = new File([input.content], `${input.kind}.json`, {
    type: "application/json",
  });
  const digest = await sha256Hex(file);
  const body = new FormData();
  body.set("file", file);
  body.set("title", input.title);
  body.set("kind", input.kind);
  body.set("byte_size", String(file.size));
  body.set("source_provenance", "workspace_editor");
  if (input.artifactId !== undefined) {
    body.set("project_artifact_id", input.artifactId);
  }
  if (input.expectedVersion !== undefined) {
    body.set("expected_version", String(input.expectedVersion));
  }
  if (input.derivedFromVersionId !== undefined) {
    body.set("derived_from_version_id", input.derivedFromVersionId);
  }
  return requestLaw(
    projectArtifactPath(input.tenantId, input.matterId),
    {
      method: "POST",
      body,
      signal: input.signal,
      headers: {
        "Idempotency-Key": input.idempotencyKey,
        "X-Content-SHA256": digest,
      },
    },
    "无法保存案情分析或诉讼策略。",
  );
}

export async function fetchProjectArtifactContent(
  version: ProjectArtifactVersion,
  signal?: AbortSignal,
): Promise<Blob> {
  const response = await fetchWithAuth(
    lawUrl(
      `${projectArtifactPath(version.tenant_id, version.matter_id)}/${encodeURIComponent(version.project_artifact_id)}/versions/${encodeURIComponent(version.id)}/content`,
    ),
    { signal, cache: "no-store" },
  );
  if (!response.ok) {
    const error = await readError(response, "无法读取项目成果版本。");
    throw new LawRequestError(error.message, response.status, error.code);
  }
  if (
    response.status !== 200 ||
    response.headers.has("Content-Range") ||
    Number(response.headers.get("Content-Length")) > 50 * 1024 * 1024
  ) {
    await response.body?.cancel();
    throw new Error("项目成果响应不完整或超过大小限制。");
  }
  const blob = await response.blob();
  if (
    blob.size !== version.byte_size ||
    (await sha256Hex(blob)) !== version.sha256
  ) {
    throw new Error("项目成果内容与所选版本不一致，已停止预览。");
  }
  signal?.throwIfAborted();
  return blob;
}

export async function fetchProjectArtifactExport(
  version: ProjectArtifactVersion,
  format: ProjectArtifactExportFormat,
  signal?: AbortSignal,
): Promise<Blob> {
  const response = await fetchWithAuth(
    lawUrl(
      `${projectArtifactPath(version.tenant_id, version.matter_id)}/${encodeURIComponent(version.project_artifact_id)}/versions/${encodeURIComponent(version.id)}/exports/${format}`,
    ),
    { signal, cache: "no-store" },
  );
  if (!response.ok) {
    const error = await readError(response, "无法导出已审核成果。");
    throw new LawRequestError(error.message, response.status, error.code);
  }
  if (
    response.status !== 200 ||
    response.headers.has("Content-Range") ||
    Number(response.headers.get("Content-Length")) > 100 * 1024 * 1024 ||
    !response.headers.get("Content-Type")?.startsWith("application/zip")
  ) {
    await response.body?.cancel();
    throw new Error("成果导出响应不完整或超过大小限制。");
  }
  const blob = await response.blob();
  const signature = new Uint8Array(await blob.slice(0, 4).arrayBuffer());
  if (
    blob.size < 4 ||
    blob.size > 100 * 1024 * 1024 ||
    signature[0] !== 0x50 ||
    signature[1] !== 0x4b ||
    signature[2] !== 0x03 ||
    signature[3] !== 0x04
  ) {
    throw new Error("成果导出包格式异常，已停止下载。");
  }
  signal?.throwIfAborted();
  return blob;
}

export async function activateTenant(
  input: ActivateTenantInput,
): Promise<TenantListItem> {
  const data = await requestLaw<{
    tenant: Tenant;
    owner_membership: Membership;
  }>("/tenants/activate", jsonRequest("POST", input), "无法激活律所工作区。");
  return { tenant: data.tenant, membership: data.owner_membership };
}

export async function registerLawFirm(
  input: RegisterLawFirmInput,
): Promise<LawFirmRegistrationReceipt> {
  return requestLaw<LawFirmRegistrationReceipt>(
    "/tenants/register",
    jsonRequest("POST", input),
    "无法向能力平台提交律所登记。",
  );
}

export async function listMatters(tenantId: string): Promise<Matter[]> {
  const data = await requestLaw<{ items: Matter[] }>(
    `/tenants/${encodeURIComponent(tenantId)}/matters`,
    undefined,
    "Failed to load matters.",
  );
  return data.items;
}

export async function createMatter(
  tenantId: string,
  input: CreateMatterInput,
): Promise<Matter> {
  const data = await requestLaw<{ matter: Matter }>(
    `/tenants/${encodeURIComponent(tenantId)}/matters`,
    idempotencyRequest(input),
    "Failed to create matter.",
  );
  return data.matter;
}

export async function getMatter(
  tenantId: string,
  matterId: string,
  signal?: AbortSignal,
): Promise<Matter> {
  const data = await requestLaw<{ matter: Matter }>(
    `/tenants/${encodeURIComponent(tenantId)}/matters/${encodeURIComponent(matterId)}`,
    signal ? { signal } : undefined,
    "Failed to load matter.",
  );
  return data.matter;
}

export async function getCaseWorkbenchOverview(
  tenantId: string,
  matterId: string,
  signal?: AbortSignal,
): Promise<CaseWorkbenchOverview> {
  return requestLaw<CaseWorkbenchOverview>(
    `/tenants/${encodeURIComponent(tenantId)}/matters/${encodeURIComponent(matterId)}/case-workbench`,
    signal ? { signal, cache: "no-store" } : { cache: "no-store" },
    "无法读取案件总览。",
  );
}

export async function openCaseWorkbenchEventStream(
  tenantId: string,
  matterId: string,
  after: number,
  signal: AbortSignal,
): Promise<Response> {
  const query = new URLSearchParams({ after: String(after) });
  const response = await fetchWithAuth(
    lawUrl(
      `/tenants/${encodeURIComponent(tenantId)}/matters/${encodeURIComponent(matterId)}/case-workbench/events?${query}`,
    ),
    {
      headers: { Accept: "text/event-stream" },
      cache: "no-store",
      signal,
    },
  );
  if (!response.ok) {
    const error = await readError(response, "无法连接案件更新流。");
    throw new LawRequestError(error.message, response.status, error.code);
  }
  return response;
}

export async function getCaseWorkbenchDeadlinePage(
  tenantId: string,
  matterId: string,
  input: {
    fromAt: string;
    untilAt: string;
    offset: number;
    limit?: number;
  },
  signal?: AbortSignal,
): Promise<CaseWorkbenchDeadlinePage> {
  const query = new URLSearchParams({
    from_at: input.fromAt,
    until_at: input.untilAt,
    state: "confirmed",
    limit: String(input.limit ?? 25),
    offset: String(input.offset),
  });
  return requestLaw<CaseWorkbenchDeadlinePage>(
    `/tenants/${encodeURIComponent(tenantId)}/matters/${encodeURIComponent(matterId)}/case-workbench/deadlines?${query}`,
    signal ? { signal, cache: "no-store" } : { cache: "no-store" },
    "无法读取案件日程。",
  );
}

export async function getMatterLegalHold(
  tenantId: string,
  matterId: string,
  signal?: AbortSignal,
): Promise<MatterLegalHoldView> {
  return requestLaw<MatterLegalHoldView>(
    `/tenants/${encodeURIComponent(tenantId)}/matters/${encodeURIComponent(matterId)}/legal-hold`,
    signal ? { signal, cache: "no-store" } : { cache: "no-store" },
    "Failed to load legal-hold history.",
  );
}

export async function setMatterLegalHold(
  tenantId: string,
  matterId: string,
  input: SetMatterLegalHoldInput,
): Promise<{ matter: Matter; event: MatterLegalHoldEvent }> {
  return requestLaw<{ matter: Matter; event: MatterLegalHoldEvent }>(
    `/tenants/${encodeURIComponent(tenantId)}/matters/${encodeURIComponent(matterId)}/legal-hold`,
    jsonRequest("POST", input),
    "Failed to update legal hold.",
  );
}

export async function listMatterMembers(
  tenantId: string,
  matterId: string,
): Promise<MatterMember[]> {
  const data = await requestLaw<{ items: MatterMember[] }>(
    `/tenants/${encodeURIComponent(tenantId)}/matters/${encodeURIComponent(matterId)}/members`,
    undefined,
    "Failed to load matter members.",
  );
  return data.items;
}

export async function listMatterThreads(
  tenantId: string,
  matterId: string,
): Promise<MatterThread[]> {
  const data = await requestLaw<{ items: MatterThread[] }>(
    `/tenants/${encodeURIComponent(tenantId)}/matters/${encodeURIComponent(matterId)}/threads`,
    undefined,
    "Failed to load matter conversations.",
  );
  return data.items;
}

export async function getMatterContextByThread(
  threadId: string,
  signal?: AbortSignal,
): Promise<TrustedMatterContext> {
  const data = await requestLaw<{ context: TrustedMatterContext }>(
    `/context/by-thread/${encodeURIComponent(threadId)}`,
    signal ? { signal } : undefined,
    "This conversation is not available in an active legal work item.",
  );
  return data.context;
}

async function createEmptyThread(threadId: string): Promise<void> {
  const response = await fetchWithAuth(`${getBackendBaseURL()}/api/threads`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ thread_id: threadId, metadata: {} }),
  });
  if (!response.ok) {
    const error = await readError(response, "Failed to create conversation.");
    throw new LawRequestError(error.message, response.status, error.code);
  }
}

async function discardEmptyThread(threadId: string): Promise<void> {
  try {
    await fetchWithAuth(
      `${getBackendBaseURL()}/api/threads/${encodeURIComponent(threadId)}`,
      { method: "DELETE" },
    );
  } catch {
    // The binding error remains authoritative; cleanup is best-effort.
  }
}

export async function createMatterConversation(
  tenantId: string,
  matterId: string,
): Promise<CreatedMatterConversation> {
  const threadId = globalThis.crypto.randomUUID();
  await createEmptyThread(threadId);
  try {
    const data = await requestLaw<{ thread_mapping: MatterThread }>(
      `/tenants/${encodeURIComponent(tenantId)}/matters/${encodeURIComponent(matterId)}/threads`,
      idempotencyRequest({ thread_id: threadId, purpose: "matter-chat" }),
      "Failed to bind conversation to legal work.",
    );
    return { threadId, mapping: data.thread_mapping };
  } catch (error) {
    await discardEmptyThread(threadId);
    throw error;
  }
}

export async function detachMatterConversation(
  tenantId: string,
  matterId: string,
  mapping: Pick<MatterThread, "thread_id" | "version">,
): Promise<MatterThread> {
  const data = await requestLaw<{ thread_mapping: MatterThread }>(
    `/tenants/${encodeURIComponent(tenantId)}/matters/${encodeURIComponent(matterId)}/threads/${encodeURIComponent(mapping.thread_id)}/detach`,
    jsonRequest("POST", { expected_version: mapping.version }),
    "Failed to remove the conversation from the legal project.",
  );
  return data.thread_mapping;
}

export async function listEvidence(
  tenantId: string,
  matterId: string,
  signal?: AbortSignal,
): Promise<EvidenceItem[]> {
  const data = await requestLaw<{ items: EvidenceItem[] }>(
    matterEvidencePath(tenantId, matterId),
    signal ? { signal } : undefined,
    "Failed to load evidence.",
  );
  return data.items;
}

export async function uploadEvidence(
  tenantId: string,
  matterId: string,
  input: UploadEvidenceInput,
): Promise<{ evidence_item: EvidenceItem; evidence_version: EvidenceVersion }> {
  const contentSha256 = await sha256Hex(input.file);
  const body = new FormData();
  body.set("title", input.title);
  body.set("byte_size", String(input.file.size));
  body.set("file", input.file, input.file.name);
  return requestLaw(
    matterEvidencePath(tenantId, matterId),
    {
      method: "POST",
      headers: {
        ...idempotencyHeaders(),
        "X-Content-SHA256": contentSha256,
      },
      body,
    },
    "Failed to upload evidence.",
  );
}

export async function listEvidenceVersions(
  tenantId: string,
  matterId: string,
  evidenceItemId: string,
  signal?: AbortSignal,
): Promise<EvidenceVersion[]> {
  const data = await requestLaw<{ items: EvidenceVersion[] }>(
    `${matterEvidencePath(tenantId, matterId)}/${encodeURIComponent(evidenceItemId)}/versions`,
    signal ? { signal } : undefined,
    "Failed to load evidence versions.",
  );
  return data.items;
}

export async function fetchEvidenceContent(
  tenantId: string,
  matterId: string,
  evidenceItemId: string,
  evidenceVersionId: string,
  signal?: AbortSignal,
): Promise<Blob> {
  const response = await fetchWithAuth(
    lawUrl(
      `${evidenceVersionPath(tenantId, matterId, evidenceItemId, evidenceVersionId)}/content`,
    ),
    { signal },
  );
  if (!response.ok) {
    const error = await readError(response, "Failed to open evidence content.");
    throw new LawRequestError(error.message, response.status, error.code);
  }
  return response.blob();
}

export async function listOcrJobs(
  tenantId: string,
  matterId: string,
  evidenceItemId: string,
  evidenceVersionId: string,
): Promise<OcrJob[]> {
  const data = await requestLaw<{ items: OcrJob[] }>(
    `${evidenceVersionPath(tenantId, matterId, evidenceItemId, evidenceVersionId)}/ocr-jobs`,
    undefined,
    "Failed to load OCR jobs.",
  );
  return data.items;
}

function ocrWorkflowPath(
  tenantId: string,
  matterId: string,
  evidenceItemId: string,
  evidenceVersionId: string,
): string {
  return `${evidenceVersionPath(tenantId, matterId, evidenceItemId, evidenceVersionId)}/ocr-workflows`;
}

export async function listOcrWorkflows(
  tenantId: string,
  matterId: string,
  evidenceItemId: string,
  evidenceVersionId: string,
): Promise<OcrWorkflow[]> {
  const data = await requestLaw<{ items: OcrWorkflow[] }>(
    ocrWorkflowPath(tenantId, matterId, evidenceItemId, evidenceVersionId),
    { cache: "no-store" },
    "Failed to load OCR workflows.",
  );
  return data.items;
}

export async function planOcrWorkflow(
  tenantId: string,
  matterId: string,
  evidenceItemId: string,
  evidenceVersionId: string,
  input: PlanOcrWorkflowInput,
): Promise<OcrWorkflow> {
  const data = await requestLaw<{ ocr_workflow: OcrWorkflow }>(
    `${ocrWorkflowPath(tenantId, matterId, evidenceItemId, evidenceVersionId)}/plan`,
    idempotencyRequest(input),
    "Failed to prepare the OCR workflow.",
  );
  return data.ocr_workflow;
}

export async function transitionOcrWorkflow(
  tenantId: string,
  matterId: string,
  evidenceItemId: string,
  evidenceVersionId: string,
  workflowId: string,
  action: "start" | "pause" | "resume" | "continue-paid" | "cancel",
  expectedVersion: number,
  consent?: { quoteId: string; maxTotalMicrounits: string },
): Promise<OcrWorkflow> {
  const data = await requestLaw<{ ocr_workflow: OcrWorkflow }>(
    `${ocrWorkflowPath(tenantId, matterId, evidenceItemId, evidenceVersionId)}/${encodeURIComponent(workflowId)}/${action}`,
    jsonRequest("POST", {
      expected_version: expectedVersion,
      ...(consent
        ? {
            quote_id: consent.quoteId,
            max_total_microunits: Number(consent.maxTotalMicrounits),
          }
        : {}),
    }),
    `Failed to ${action} the OCR workflow.`,
  );
  return data.ocr_workflow;
}

export interface OcrWorkflowQuote {
  quote_id: string;
  currency: string;
  price_per_page_microunits: string;
  quoted_pages: number;
  quoted_total_microunits: string;
  payable_total_microunits?: string;
  billing_mode?: "prepaid" | "record_only";
  expires_at: string;
  accepted: boolean;
}

export async function quoteOcrWorkflow(
  tenantId: string,
  matterId: string,
  evidenceItemId: string,
  evidenceVersionId: string,
  workflowId: string,
): Promise<OcrWorkflowQuote> {
  const data = await requestLaw<{ quote: OcrWorkflowQuote }>(
    `${ocrWorkflowPath(tenantId, matterId, evidenceItemId, evidenceVersionId)}/${encodeURIComponent(workflowId)}/quote`,
    jsonRequest("POST", {}),
    "Failed to get the OCR quote.",
  );
  return data.quote;
}

export async function listOcrWorkflowEvents(
  tenantId: string,
  matterId: string,
  evidenceItemId: string,
  evidenceVersionId: string,
  workflowId: string,
  afterSeq = 0,
): Promise<OcrWorkflowEvent[]> {
  const data = await requestLaw<{ items: OcrWorkflowEvent[] }>(
    `${ocrWorkflowPath(tenantId, matterId, evidenceItemId, evidenceVersionId)}/${encodeURIComponent(workflowId)}/events?after_seq=${afterSeq}`,
    { cache: "no-store" },
    "Failed to load OCR workflow events.",
  );
  return data.items;
}

function ocrPageDraftPath(
  tenantId: string,
  matterId: string,
  evidenceItemId: string,
  evidenceVersionId: string,
  physicalPageNumber: number,
): string {
  return `${evidenceVersionPath(tenantId, matterId, evidenceItemId, evidenceVersionId)}/ocr-page-drafts/${physicalPageNumber}`;
}

function ocrPageDraftCollectionPath(
  tenantId: string,
  matterId: string,
  evidenceItemId: string,
  evidenceVersionId: string,
): string {
  return `${evidenceVersionPath(tenantId, matterId, evidenceItemId, evidenceVersionId)}/ocr-page-drafts`;
}

export async function getOcrProofreadingCollection(
  tenantId: string,
  matterId: string,
  evidenceItemId: string,
  evidenceVersionId: string,
): Promise<OcrProofreadingCollection> {
  return requestLaw<OcrProofreadingCollection>(
    ocrPageDraftCollectionPath(
      tenantId,
      matterId,
      evidenceItemId,
      evidenceVersionId,
    ),
    { cache: "no-store" },
    "Failed to load the OCR proofreading collection.",
  );
}

export async function publishOcrProofreading(
  tenantId: string,
  matterId: string,
  evidenceItemId: string,
  evidenceVersionId: string,
  input: {
    expected_versions: Record<number, number>;
    allow_partial: boolean;
    table_merges?: Array<{
      first: OcrTableMergeSelection;
      second: OcrTableMergeSelection;
      header_row_count?: number;
    }>;
  },
): Promise<OcrProofreadingPublication> {
  const data = await requestLaw<{
    ocr_proofreading_publication: OcrProofreadingPublication;
  }>(
    `${ocrPageDraftCollectionPath(tenantId, matterId, evidenceItemId, evidenceVersionId)}/publish`,
    jsonRequest("POST", input),
    "Failed to publish the OCR proofreading version.",
  );
  return data.ocr_proofreading_publication;
}

export async function getOcrProofreadingPublication(
  tenantId: string,
  matterId: string,
  evidenceItemId: string,
  evidenceVersionId: string,
  publicationId: string,
): Promise<OcrProofreadingPublication> {
  const data = await requestLaw<{
    ocr_proofreading_publication: OcrProofreadingPublication;
  }>(
    `${ocrPageDraftCollectionPath(tenantId, matterId, evidenceItemId, evidenceVersionId)}/publications/${encodeURIComponent(publicationId)}`,
    { cache: "no-store" },
    "Failed to load the OCR proofreading version.",
  );
  return data.ocr_proofreading_publication;
}

export async function getOcrPageDraft(
  tenantId: string,
  matterId: string,
  evidenceItemId: string,
  evidenceVersionId: string,
  physicalPageNumber: number,
  ocrJobId: string,
): Promise<OcrPageDraft> {
  const data = await requestLaw<{ ocr_page_draft: OcrPageDraft }>(
    `${ocrPageDraftPath(tenantId, matterId, evidenceItemId, evidenceVersionId, physicalPageNumber)}?ocr_job_id=${encodeURIComponent(ocrJobId)}`,
    { cache: "no-store" },
    "Failed to load the OCR proofreading draft.",
  );
  return data.ocr_page_draft;
}

export async function saveOcrPageDraft(
  tenantId: string,
  matterId: string,
  evidenceItemId: string,
  evidenceVersionId: string,
  physicalPageNumber: number,
  input: {
    ocr_job_id: string;
    markdown_text: string;
    expected_version: number;
  },
): Promise<OcrPageDraft> {
  const data = await requestLaw<{ ocr_page_draft: OcrPageDraft }>(
    ocrPageDraftPath(
      tenantId,
      matterId,
      evidenceItemId,
      evidenceVersionId,
      physicalPageNumber,
    ),
    jsonRequest("PUT", input),
    "Failed to save the OCR proofreading draft.",
  );
  return data.ocr_page_draft;
}

export async function reviewOcrPageDraft(
  tenantId: string,
  matterId: string,
  evidenceItemId: string,
  evidenceVersionId: string,
  physicalPageNumber: number,
  input: { ocr_job_id: string; expected_version: number },
): Promise<OcrPageDraft> {
  const data = await requestLaw<{ ocr_page_draft: OcrPageDraft }>(
    `${ocrPageDraftPath(tenantId, matterId, evidenceItemId, evidenceVersionId, physicalPageNumber)}/review`,
    jsonRequest("POST", input),
    "Failed to mark the OCR page as reviewed.",
  );
  return data.ocr_page_draft;
}

export async function scheduleOcrJob(
  tenantId: string,
  matterId: string,
  evidenceItemId: string,
  evidenceVersionId: string,
  input: ScheduleOcrInput,
): Promise<OcrJob> {
  const data = await requestLaw<{ ocr_job: OcrJob }>(
    `${evidenceVersionPath(tenantId, matterId, evidenceItemId, evidenceVersionId)}/ocr-jobs`,
    idempotencyRequest(input),
    "Failed to schedule OCR.",
  );
  return data.ocr_job;
}

export async function rerunOcrJob(
  tenantId: string,
  matterId: string,
  evidenceItemId: string,
  evidenceVersionId: string,
  input: RerunOcrInput,
): Promise<OcrJob> {
  const data = await requestLaw<{ ocr_job: OcrJob }>(
    `${evidenceVersionPath(tenantId, matterId, evidenceItemId, evidenceVersionId)}/ocr-jobs/${encodeURIComponent(input.ocr_job_id)}/rerun`,
    idempotencyRequest({
      physical_pages: input.physical_pages,
      page_rotations: input.page_rotations,
    }),
    "Failed to rerun OCR.",
  );
  return data.ocr_job;
}

export async function getCurrentOcrDocumentRevision(
  tenantId: string,
  matterId: string,
  evidenceItemId: string,
  evidenceVersionId: string,
): Promise<OcrDocumentRevisionState> {
  const data = await requestLaw<{
    document_revision: OcrDocumentRevisionState;
  }>(
    `${evidenceVersionPath(tenantId, matterId, evidenceItemId, evidenceVersionId)}/ocr-jobs/current-document-revision`,
    { cache: "no-store" },
    "Failed to load the current OCR document revision.",
  );
  return data.document_revision;
}

export async function adoptOcrJobResult(
  tenantId: string,
  matterId: string,
  evidenceItemId: string,
  evidenceVersionId: string,
  ocrJobId: string,
  expectedVersion: number,
): Promise<OcrDocumentRevisionState> {
  const data = await requestLaw<{
    document_revision: OcrDocumentRevisionState;
  }>(
    `${evidenceVersionPath(tenantId, matterId, evidenceItemId, evidenceVersionId)}/ocr-jobs/${encodeURIComponent(ocrJobId)}/adopt`,
    idempotencyRequest({ expected_version: expectedVersion }),
    "Failed to adopt the OCR result.",
  );
  return data.document_revision;
}

export async function cancelOcrJob(
  tenantId: string,
  matterId: string,
  evidenceItemId: string,
  evidenceVersionId: string,
  ocrJobId: string,
): Promise<OcrJob> {
  const data = await requestLaw<{ ocr_job: OcrJob }>(
    `${evidenceVersionPath(tenantId, matterId, evidenceItemId, evidenceVersionId)}/ocr-jobs/${encodeURIComponent(ocrJobId)}/cancel`,
    {
      method: "POST",
      headers: idempotencyHeaders(),
    },
    "Failed to cancel OCR.",
  );
  return data.ocr_job;
}

export async function getOcrResult(
  tenantId: string,
  matterId: string,
  evidenceItemId: string,
  evidenceVersionId: string,
  ocrJobId: string,
): Promise<OcrResult> {
  const data = await requestLaw<{ ocr_result: OcrResult }>(
    `${evidenceVersionPath(tenantId, matterId, evidenceItemId, evidenceVersionId)}/ocr-jobs/${encodeURIComponent(ocrJobId)}/result`,
    undefined,
    "Failed to load OCR result.",
  );
  return data.ocr_result;
}

export async function getOcrPage(
  tenantId: string,
  matterId: string,
  evidenceItemId: string,
  evidenceVersionId: string,
  ocrJobId: string,
  physicalPageNumber: number,
): Promise<OcrPage> {
  const data = await requestLaw<{ ocr_page: OcrPage }>(
    `${evidenceVersionPath(tenantId, matterId, evidenceItemId, evidenceVersionId)}/ocr-jobs/${encodeURIComponent(ocrJobId)}/result/pages/${physicalPageNumber}`,
    undefined,
    "Failed to load OCR page.",
  );
  return data.ocr_page;
}

export async function reviewOcrBlock(
  tenantId: string,
  matterId: string,
  evidenceItemId: string,
  evidenceVersionId: string,
  ocrJobId: string,
  physicalPageNumber: number,
  ocrBlockId: string,
  decision: "verified" | "rejected",
): Promise<OcrBlockReview> {
  const data = await requestLaw<{ ocr_block_review: OcrBlockReview }>(
    `${evidenceVersionPath(tenantId, matterId, evidenceItemId, evidenceVersionId)}/ocr-jobs/${encodeURIComponent(ocrJobId)}/result/pages/${physicalPageNumber}/blocks/${encodeURIComponent(ocrBlockId)}/reviews`,
    idempotencyRequest({ decision }),
    "Failed to record the OCR block review.",
  );
  return data.ocr_block_review;
}

export async function requestOcrFormulaOpinion(
  tenantId: string,
  matterId: string,
  evidenceItemId: string,
  evidenceVersionId: string,
  ocrJobId: string,
  physicalPageNumber: number,
  ocrBlockId: string,
): Promise<OcrFormulaOpinion> {
  return requestLaw<OcrFormulaOpinion>(
    `${ocrBlockPath(tenantId, matterId, evidenceItemId, evidenceVersionId, ocrJobId, physicalPageNumber, ocrBlockId)}/formula-opinion`,
    { method: "POST" },
    "Failed to get a private formula opinion.",
  );
}

export async function getOcrFormulaOpinion(
  tenantId: string,
  matterId: string,
  evidenceItemId: string,
  evidenceVersionId: string,
  ocrJobId: string,
  physicalPageNumber: number,
  ocrBlockId: string,
): Promise<OcrFormulaOpinion | null> {
  return requestLaw<OcrFormulaOpinion | null>(
    `${ocrBlockPath(tenantId, matterId, evidenceItemId, evidenceVersionId, ocrJobId, physicalPageNumber, ocrBlockId)}/formula-opinion`,
    undefined,
    "Failed to load the saved formula opinion.",
  );
}

export async function requestOcrTableOpinion(
  tenantId: string,
  matterId: string,
  evidenceItemId: string,
  evidenceVersionId: string,
  ocrJobId: string,
  physicalPageNumber: number,
  ocrBlockId: string,
): Promise<OcrTableOpinion> {
  return requestLaw<OcrTableOpinion>(
    `${ocrBlockPath(tenantId, matterId, evidenceItemId, evidenceVersionId, ocrJobId, physicalPageNumber, ocrBlockId)}/table-opinion`,
    { method: "POST" },
    "Failed to get a private table opinion.",
  );
}

export async function getOcrTableOpinion(
  tenantId: string,
  matterId: string,
  evidenceItemId: string,
  evidenceVersionId: string,
  ocrJobId: string,
  physicalPageNumber: number,
  ocrBlockId: string,
): Promise<OcrTableOpinion | null> {
  return requestLaw<OcrTableOpinion | null>(
    `${ocrBlockPath(tenantId, matterId, evidenceItemId, evidenceVersionId, ocrJobId, physicalPageNumber, ocrBlockId)}/table-opinion`,
    undefined,
    "Failed to load the saved table opinion.",
  );
}

function ocrBlockPath(
  tenantId: string,
  matterId: string,
  evidenceItemId: string,
  evidenceVersionId: string,
  ocrJobId: string,
  physicalPageNumber: number,
  ocrBlockId: string,
): string {
  return `${evidenceVersionPath(tenantId, matterId, evidenceItemId, evidenceVersionId)}/ocr-jobs/${encodeURIComponent(ocrJobId)}/result/pages/${physicalPageNumber}/blocks/${encodeURIComponent(ocrBlockId)}`;
}

export async function proposeOcrBlockCorrection(
  tenantId: string,
  matterId: string,
  evidenceItemId: string,
  evidenceVersionId: string,
  ocrJobId: string,
  physicalPageNumber: number,
  ocrBlockId: string,
  input: ProposeOcrCorrectionInput,
): Promise<OcrBlockCorrection> {
  const data = await requestLaw<{
    ocr_block_correction: OcrBlockCorrection;
  }>(
    `${ocrBlockPath(tenantId, matterId, evidenceItemId, evidenceVersionId, ocrJobId, physicalPageNumber, ocrBlockId)}/corrections`,
    idempotencyRequest(input),
    "Failed to propose the OCR correction.",
  );
  return data.ocr_block_correction;
}

export async function reviewOcrBlockCorrection(
  tenantId: string,
  matterId: string,
  evidenceItemId: string,
  evidenceVersionId: string,
  ocrJobId: string,
  physicalPageNumber: number,
  ocrBlockId: string,
  correctionId: string,
  input: ReviewOcrCorrectionInput,
): Promise<OcrBlockCorrection> {
  const data = await requestLaw<{
    ocr_block_correction: OcrBlockCorrection;
  }>(
    `${ocrBlockPath(tenantId, matterId, evidenceItemId, evidenceVersionId, ocrJobId, physicalPageNumber, ocrBlockId)}/corrections/${encodeURIComponent(correctionId)}/reviews`,
    idempotencyRequest(input),
    "Failed to review the OCR correction.",
  );
  return data.ocr_block_correction;
}

export async function listOcrReviewQueue(
  tenantId: string,
  matterId: string,
): Promise<OcrReviewQueueEntry[]> {
  const data = await requestLaw<{ items: OcrReviewQueueEntry[] }>(
    `/tenants/${encodeURIComponent(tenantId)}/matters/${encodeURIComponent(matterId)}/ocr-review-queue`,
    undefined,
    "Failed to load the OCR review queue.",
  );
  return data.items;
}

export async function listCitations(
  tenantId: string,
  matterId: string,
  evidenceItemId: string,
  evidenceVersionId: string,
  signal?: AbortSignal,
): Promise<OcrCitation[]> {
  const data = await requestLaw<{ items: OcrCitation[] }>(
    `${evidenceVersionPath(tenantId, matterId, evidenceItemId, evidenceVersionId)}/citations`,
    signal ? { signal } : undefined,
    "Failed to load citations.",
  );
  return data.items;
}

export async function getCitation(
  tenantId: string,
  matterId: string,
  evidenceItemId: string,
  evidenceVersionId: string,
  citationId: string,
  signal?: AbortSignal,
): Promise<OcrCitation> {
  const data = await requestLaw<{ citation: OcrCitation }>(
    `${evidenceVersionPath(tenantId, matterId, evidenceItemId, evidenceVersionId)}/citations/${encodeURIComponent(citationId)}`,
    { signal, cache: "no-store" },
    "Failed to load citation.",
  );
  return data.citation;
}

export async function createCitation(
  tenantId: string,
  matterId: string,
  evidenceItemId: string,
  evidenceVersionId: string,
  input: CreateCitationInput,
): Promise<OcrCitation> {
  const data = await requestLaw<{ citation: OcrCitation }>(
    `${evidenceVersionPath(tenantId, matterId, evidenceItemId, evidenceVersionId)}/citations`,
    idempotencyRequest(input),
    "Failed to create citation.",
  );
  return data.citation;
}

export async function listMatterMemoryEntries(
  tenantId: string,
  matterId: string,
  signal?: AbortSignal,
): Promise<MatterMemoryCollection> {
  return requestLaw<MatterMemoryCollection>(
    `/tenants/${encodeURIComponent(tenantId)}/matters/${encodeURIComponent(matterId)}/memory-entries`,
    signal ? { signal, cache: "no-store" } : { cache: "no-store" },
    "无法读取案件记忆。",
  );
}

export async function decideMatterMemoryEntry(
  tenantId: string,
  matterId: string,
  memoryEntryId: string,
  input: DecideMatterMemoryInput,
): Promise<MatterMemoryDecisionReceipt> {
  return requestLaw<MatterMemoryDecisionReceipt>(
    `/tenants/${encodeURIComponent(tenantId)}/matters/${encodeURIComponent(matterId)}/memory-entries/${encodeURIComponent(memoryEntryId)}/decisions`,
    jsonRequest("POST", input),
    "无法保存案件记忆审核结果。",
  );
}

function matterDeadlinesPath(tenantId: string, matterId: string): string {
  return `/tenants/${encodeURIComponent(tenantId)}/matters/${encodeURIComponent(matterId)}/deadlines`;
}

export async function listMatterDeadlines(
  tenantId: string,
  matterId: string,
  signal?: AbortSignal,
): Promise<MatterDeadline[]> {
  const data = await requestLaw<{ items: MatterDeadline[] }>(
    `${matterDeadlinesPath(tenantId, matterId)}?limit=100`,
    { signal, cache: "no-store" },
    "无法读取案件期限。",
  );
  return data.items;
}

function matterSpeechTranscriptionsPath(
  tenantId: string,
  matterId: string,
): string {
  return `/tenants/${encodeURIComponent(tenantId)}/matters/${encodeURIComponent(matterId)}/speech-transcriptions`;
}

function matterSpeechCapturePath(
  tenantId: string,
  matterId: string,
  captureId?: string,
): string {
  const base = `${matterSpeechTranscriptionsPath(tenantId, matterId)}/live-captures`;
  return captureId ? `${base}/${encodeURIComponent(captureId)}` : base;
}

export async function createMatterSpeechCapture(
  tenantId: string,
  matterId: string,
  input: {
    title: string;
    media_type: string;
    capture_protocol?: "container_v1" | "pcm_s16le_v1";
    audioTrackSettings?: SpeechCaptureAudioTrackSettings | null;
    idempotencyKey?: string;
  },
): Promise<SpeechCaptureCreateReceipt> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (input.idempotencyKey) headers["Idempotency-Key"] = input.idempotencyKey;
  const payload = {
    title: input.title,
    media_type: input.media_type,
    ...(input.capture_protocol
      ? { capture_protocol: input.capture_protocol }
      : {}),
    ...(input.audioTrackSettings
      ? { audio_track_settings: input.audioTrackSettings }
      : {}),
  };
  return requestLaw<SpeechCaptureCreateReceipt>(
    matterSpeechCapturePath(tenantId, matterId),
    { method: "POST", headers, body: JSON.stringify(payload) },
    "无法创建录音会话。",
  );
}

export async function listMatterSpeechCaptures(
  tenantId: string,
  matterId: string,
  signal?: AbortSignal,
): Promise<SpeechCaptureSession[]> {
  const result = await requestLaw<{ items: SpeechCaptureSession[] }>(
    `${matterSpeechCapturePath(tenantId, matterId)}?limit=100`,
    { signal, cache: "no-store" },
    "无法读取待恢复录音。",
  );
  return result.items;
}

export async function listMatterSpeechCaptureChunks(
  tenantId: string,
  matterId: string,
  captureId: string,
  afterSequence = -1,
  signal?: AbortSignal,
): Promise<SpeechCaptureChunkReceiptPage> {
  const query = new URLSearchParams({
    after_sequence: String(afterSequence),
    limit: "500",
  });
  return requestLaw<SpeechCaptureChunkReceiptPage>(
    `${matterSpeechCapturePath(tenantId, matterId, captureId)}/chunks?${query}`,
    { signal, cache: "no-store" },
    "无法核对录音分片回执。",
  );
}

export async function getMatterSpeechCapturePreview(
  tenantId: string,
  matterId: string,
  captureId: string,
  afterRevision: number,
  signal?: AbortSignal,
): Promise<SpeechCapturePreviewReceipt | null> {
  const query = new URLSearchParams({ after_revision: String(afterRevision) });
  const response = await fetchWithAuth(
    lawUrl(
      `${matterSpeechCapturePath(tenantId, matterId, captureId)}/preview?${query}`,
    ),
    { signal, cache: "no-store" },
  );
  if (response.status === 204) return null;
  if (!response.ok) {
    const error = await readError(response, "无法读取录音实时预览。");
    throw new LawRequestError(error.message, response.status, error.code);
  }
  const body =
    (await response.json()) as LawEnvelope<SpeechCapturePreviewReceipt>;
  return body.data;
}

export async function getMatterSpeechCapture(
  tenantId: string,
  matterId: string,
  captureId: string,
  signal?: AbortSignal,
): Promise<SpeechCaptureSession> {
  return requestLaw<SpeechCaptureSession>(
    matterSpeechCapturePath(tenantId, matterId, captureId),
    { signal, cache: "no-store" },
    "无法恢复录音会话。",
  );
}

export async function uploadMatterSpeechCaptureChunk(
  tenantId: string,
  matterId: string,
  captureId: string,
  sequenceNumber: number,
  chunk: Blob,
  sha256: string,
  pcm?: { sampleCount: number; startSample: number },
): Promise<SpeechCaptureChunkReceipt> {
  const headers: Record<string, string> = {
    "Content-Type": "application/octet-stream",
    "X-Chunk-SHA256": sha256,
  };
  if (pcm) {
    headers["X-Sample-Count"] = String(pcm.sampleCount);
    headers["X-Start-Sample"] = String(pcm.startSample);
  }
  return requestLaw<SpeechCaptureChunkReceipt>(
    `${matterSpeechCapturePath(tenantId, matterId, captureId)}/chunks/${sequenceNumber}`,
    {
      method: "PUT",
      headers,
      body: chunk,
    },
    "录音分片上传失败。",
  );
}

export async function finishMatterSpeechCapture(
  tenantId: string,
  matterId: string,
  captureId: string,
  finalSequenceNumber: number,
  totalSamples?: number,
  endReason: "user_stop" | "interrupted" | "limit_reached" = "user_stop",
): Promise<SpeechCaptureFinishReceipt> {
  return requestLaw<SpeechCaptureFinishReceipt>(
    `${matterSpeechCapturePath(tenantId, matterId, captureId)}/finish`,
    jsonRequest("POST", {
      final_sequence_number: finalSequenceNumber,
      ...(totalSamples === undefined ? {} : { total_samples: totalSamples }),
      end_reason: endReason,
    }),
    "无法完成录音保存。",
  );
}

export async function cancelMatterSpeechCapture(
  tenantId: string,
  matterId: string,
  captureId: string,
): Promise<SpeechCaptureSession> {
  return requestLaw<SpeechCaptureSession>(
    `${matterSpeechCapturePath(tenantId, matterId, captureId)}/cancel`,
    { method: "POST" },
    "无法取消录音会话。",
  );
}

export async function listMatterSpeechTranscriptions(
  tenantId: string,
  matterId: string,
  signal?: AbortSignal,
): Promise<SpeechTranscriptionCollection> {
  return requestLaw<SpeechTranscriptionCollection>(
    matterSpeechTranscriptionsPath(tenantId, matterId),
    { signal, cache: "no-store" },
    "无法读取语音转写任务。",
  );
}

export async function createMatterSpeechTranscription(
  tenantId: string,
  matterId: string,
  evidenceItemId: string,
  evidenceVersionId: string,
): Promise<SpeechTranscriptionTask> {
  const query = new URLSearchParams({
    evidence_item_id: evidenceItemId,
    evidence_version_id: evidenceVersionId,
  });
  return requestLaw<SpeechTranscriptionTask>(
    `${matterSpeechTranscriptionsPath(tenantId, matterId)}?${query}`,
    { method: "POST", headers: idempotencyHeaders() },
    "无法启动本地语音转写。",
  );
}

export async function getMatterSpeechTranscription(
  tenantId: string,
  matterId: string,
  taskId: string,
  signal?: AbortSignal,
): Promise<SpeechTranscriptionDetail> {
  return requestLaw<SpeechTranscriptionDetail>(
    `${matterSpeechTranscriptionsPath(tenantId, matterId)}/${encodeURIComponent(taskId)}`,
    { signal, cache: "no-store" },
    "无法读取语音转写详情。",
  );
}

export async function cancelMatterSpeechTranscription(
  tenantId: string,
  matterId: string,
  taskId: string,
): Promise<SpeechTranscriptionTask> {
  return requestLaw<SpeechTranscriptionTask>(
    `${matterSpeechTranscriptionsPath(tenantId, matterId)}/${encodeURIComponent(taskId)}/cancel`,
    { method: "POST" },
    "无法取消语音转写任务。",
  );
}

export async function reviewMatterSpeechTranscription(
  tenantId: string,
  matterId: string,
  taskId: string,
  input: ReviewSpeechTranscriptInput,
): Promise<ReviewSpeechTranscriptReceipt> {
  return requestLaw<ReviewSpeechTranscriptReceipt>(
    `${matterSpeechTranscriptionsPath(tenantId, matterId)}/${encodeURIComponent(taskId)}/review`,
    jsonRequest("POST", input),
    "无法保存律师校对版本。",
  );
}

export async function listMatterSpeechCitations(
  tenantId: string,
  matterId: string,
  taskId: string,
  signal?: AbortSignal,
): Promise<SpeechTranscriptCitation[]> {
  const result = await requestLaw<{ items: SpeechTranscriptCitation[] }>(
    `${matterSpeechTranscriptionsPath(tenantId, matterId)}/${encodeURIComponent(taskId)}/citations`,
    { signal, cache: "no-store" },
    "无法读取录音引用。",
  );
  return result.items;
}

export async function createMatterSpeechCitation(
  tenantId: string,
  matterId: string,
  taskId: string,
  input: CreateSpeechTranscriptCitationInput,
): Promise<SpeechTranscriptCitation> {
  const result = await requestLaw<{ citation: SpeechTranscriptCitation }>(
    `${matterSpeechTranscriptionsPath(tenantId, matterId)}/${encodeURIComponent(taskId)}/citations`,
    jsonRequest("POST", input),
    "无法创建录音时间引用。",
  );
  return result.citation;
}

export async function listMatterDeadlineRecipients(
  tenantId: string,
  matterId: string,
  signal?: AbortSignal,
): Promise<MatterDeadlineRecipient[]> {
  const data = await requestLaw<{ items: MatterDeadlineRecipient[] }>(
    `/tenants/${encodeURIComponent(tenantId)}/matters/${encodeURIComponent(matterId)}/deadline-recipients`,
    { signal, cache: "no-store" },
    "无法读取可接收期限提醒的案件成员。",
  );
  return data.items;
}

export async function createMatterDeadline(
  tenantId: string,
  matterId: string,
  input: CreateMatterDeadlineInput,
): Promise<MatterDeadline> {
  return requestLaw<MatterDeadline>(
    matterDeadlinesPath(tenantId, matterId),
    idempotencyRequest(input),
    "无法保存期限提案。",
  );
}

export async function confirmMatterDeadline(
  tenantId: string,
  matterId: string,
  deadlineId: string,
  input: ConfirmMatterDeadlineInput,
): Promise<MatterDeadline> {
  return requestLaw<MatterDeadline>(
    `${matterDeadlinesPath(tenantId, matterId)}/${encodeURIComponent(deadlineId)}/confirm`,
    idempotencyRequest(input),
    "无法确认期限或安排提醒。请刷新后核对当前状态。",
  );
}

export async function rescheduleMatterDeadline(
  tenantId: string,
  matterId: string,
  deadlineId: string,
  input: RescheduleMatterDeadlineInput,
): Promise<MatterDeadline> {
  return requestLaw<MatterDeadline>(
    `${matterDeadlinesPath(tenantId, matterId)}/${encodeURIComponent(deadlineId)}/reschedule`,
    idempotencyRequest(input),
    "无法改期或重新安排提醒。请刷新后核对当前状态。",
  );
}

export async function transitionMatterDeadline(
  tenantId: string,
  matterId: string,
  deadlineId: string,
  targetState: "cancelled" | "completed",
  input: TransitionMatterDeadlineInput,
): Promise<MatterDeadline> {
  return requestLaw<MatterDeadline>(
    `${matterDeadlinesPath(tenantId, matterId)}/${encodeURIComponent(deadlineId)}/transition?target_state=${targetState}`,
    idempotencyRequest(input),
    targetState === "cancelled"
      ? "无法取消期限。请刷新后核对当前状态。"
      : "无法完成期限事项。请刷新后核对当前状态。",
  );
}

export async function listMatterDeadlineEvents(
  tenantId: string,
  matterId: string,
  deadlineId: string,
  signal?: AbortSignal,
): Promise<MatterDeadlineEvent[]> {
  const data = await requestLaw<{ items: MatterDeadlineEvent[] }>(
    `${matterDeadlinesPath(tenantId, matterId)}/${encodeURIComponent(deadlineId)}/events`,
    { signal, cache: "no-store" },
    "无法读取期限变更记录。",
  );
  return data.items;
}

export async function listMatterNotificationOutbox(
  tenantId: string,
  matterId: string,
  signal?: AbortSignal,
): Promise<MatterNotificationOutboxItem[]> {
  const data = await requestLaw<{ items: MatterNotificationOutboxItem[] }>(
    `/tenants/${encodeURIComponent(tenantId)}/matters/${encodeURIComponent(matterId)}/notifications/outbox?limit=100`,
    { signal, cache: "no-store" },
    "无法读取我的期限提醒安排。",
  );
  return data.items;
}

export async function markMatterNotificationRead(
  tenantId: string,
  matterId: string,
  notificationId: string,
): Promise<MatterNotificationOutboxItem> {
  return requestLaw<MatterNotificationOutboxItem>(
    `/tenants/${encodeURIComponent(tenantId)}/matters/${encodeURIComponent(matterId)}/notifications/outbox/${encodeURIComponent(notificationId)}/read`,
    jsonRequest("POST", {}),
    "无法更新提醒的已读状态。",
  );
}

function matterAuthoritiesPath(tenantId: string, matterId: string): string {
  return `/tenants/${encodeURIComponent(tenantId)}/matters/${encodeURIComponent(matterId)}/authorities`;
}

export async function listLegalAuthorities(
  tenantId: string,
  matterId: string,
  options: {
    query?: string;
    favoritesOnly?: boolean;
    signal?: AbortSignal;
  } = {},
): Promise<LegalAuthorityCollection> {
  const params = new URLSearchParams();
  if (options.query?.trim()) params.set("q", options.query.trim());
  if (options.favoritesOnly) params.set("favorites_only", "true");
  const suffix = params.size ? `?${params.toString()}` : "";
  return requestLaw<LegalAuthorityCollection>(
    `${matterAuthoritiesPath(tenantId, matterId)}${suffix}`,
    { signal: options.signal, cache: "no-store" },
    "无法读取案件法律依据。",
  );
}

export async function captureLegalAuthority(
  tenantId: string,
  matterId: string,
  officialUrl: string,
): Promise<LegalAuthorityCaptureReceipt> {
  return requestLaw<LegalAuthorityCaptureReceipt>(
    `${matterAuthoritiesPath(tenantId, matterId)}/capture`,
    jsonRequest("POST", { official_url: officialUrl }),
    "无法从官方来源获取法律依据。",
  );
}

export async function refreshLegalAuthority(
  tenantId: string,
  matterId: string,
  documentId: string,
): Promise<LegalAuthorityCaptureReceipt> {
  return requestLaw<LegalAuthorityCaptureReceipt>(
    `${matterAuthoritiesPath(tenantId, matterId)}/${encodeURIComponent(documentId)}/refresh`,
    jsonRequest("POST", {}),
    "无法检查法律依据更新。",
  );
}

export async function setLegalAuthorityFavorite(
  tenantId: string,
  matterId: string,
  documentId: string,
  isFavorite: boolean,
) {
  return requestLaw(
    `${matterAuthoritiesPath(tenantId, matterId)}/${encodeURIComponent(documentId)}/favorite`,
    jsonRequest("POST", { is_favorite: isFavorite }),
    "无法更新法律依据收藏状态。",
  );
}

export async function listLegalAuthorityVersions(
  tenantId: string,
  matterId: string,
  documentId: string,
  signal?: AbortSignal,
): Promise<LegalAuthorityVersionSummary[]> {
  const data = await requestLaw<{ items: LegalAuthorityVersionSummary[] }>(
    `${matterAuthoritiesPath(tenantId, matterId)}/${encodeURIComponent(documentId)}/versions`,
    { signal, cache: "no-store" },
    "无法读取法律依据版本历史。",
  );
  return data.items;
}

export async function readLegalAuthorityVersion(
  tenantId: string,
  matterId: string,
  documentId: string,
  versionId: string,
  offset = 0,
  signal?: AbortSignal,
): Promise<LegalAuthorityVersionContent> {
  const query = new URLSearchParams({ offset: String(offset), length: "4000" });
  return requestLaw<LegalAuthorityVersionContent>(
    `${matterAuthoritiesPath(tenantId, matterId)}/${encodeURIComponent(documentId)}/versions/${encodeURIComponent(versionId)}?${query}`,
    { signal, cache: "no-store" },
    "无法读取法律依据正文。",
  );
}

export async function reviewLegalAuthorityVersion(
  tenantId: string,
  matterId: string,
  documentId: string,
  versionId: string,
  input: CreateLegalAuthorityReviewInput,
): Promise<{ review: LegalAuthorityReview }> {
  return requestLaw(
    `${matterAuthoritiesPath(tenantId, matterId)}/${encodeURIComponent(documentId)}/versions/${encodeURIComponent(versionId)}/reviews`,
    jsonRequest("POST", input),
    "无法保存律师效力核验记录。",
  );
}

export async function saveLegalAuthoritySummary(
  tenantId: string,
  matterId: string,
  documentId: string,
  versionId: string,
  input: CreateLegalAuthoritySummaryInput,
): Promise<{ summary: LegalAuthoritySummary }> {
  return requestLaw(
    `${matterAuthoritiesPath(tenantId, matterId)}/${encodeURIComponent(documentId)}/versions/${encodeURIComponent(versionId)}/summaries`,
    jsonRequest("POST", input),
    "无法保存法律依据摘要。",
  );
}
