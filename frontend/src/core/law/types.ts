export type TenantRole = "owner" | "admin" | "member" | "auditor" | "finance";
export type OnboardingApplicationType = "law_firm" | "lawyer";
export type OnboardingApplicationStatus =
  | "submitted"
  | "needs_more_info"
  | "approved"
  | "rejected"
  | "provision_failed";

export interface OnboardingApplication {
  id: string;
  applicant_user_id: string;
  application_type: OnboardingApplicationType;
  status: OnboardingApplicationStatus;
  organization_name: string | null;
  desired_slug: string | null;
  display_name: string | null;
  license_number: string | null;
  target_tenant_id: string | null;
  provisioned_tenant_id: string | null;
  reviewed_by_user_id: string | null;
  public_note: string | null;
  internal_note?: string | null;
  submitted_at: string;
  reviewed_at: string | null;
  version: number;
  created_at: string;
  updated_at: string;
}

export interface PlatformOnboardingOverview {
  pending_law_firms: number;
  pending_lawyers: number;
  needs_more_info: number;
  approved_total: number;
  active_tenants: number;
  active_memberships: number;
}

export interface TenantAdministrationOverview {
  pending_lawyers: number;
  needs_more_info: number;
  approved_lawyers: number;
  active_members: number;
  audit_events: number;
}

export type CapabilityConnectionStatus = "blocked" | "degraded" | "connected";

export interface CapabilitySnapshotItem {
  capability_id: string;
  capability_version: string;
  decision: "allow" | "deny";
  expires_at: string | null;
}

export interface CapabilitySnapshot {
  snapshot_id: string | null;
  policy_revision: number | null;
  issued_at: string | null;
  expires_at: string | null;
  capabilities: CapabilitySnapshotItem[];
}

export interface CapabilitySubaccount {
  membership_id: string | null;
  currency: string | null;
  limit_microunits: string | null;
  reserved_microunits: string | null;
  settled_microunits: string | null;
  available_microunits: string | null;
  status: string | null;
  updated_at: string | null;
}

export interface CapabilityUsageEntry {
  event_type: string | null;
  currency: string | null;
  tenant_payable_microunits: string | null;
  matter_id: string | null;
  run_id: string | null;
  occurred_at: string | null;
  resource_id: string | null;
  reservation_status: string | null;
}

export interface CapabilityConnectionView {
  status: CapabilityConnectionStatus;
  code: string;
  message: string;
  snapshot: CapabilitySnapshot | null;
  subaccounts: CapabilitySubaccount[] | null;
  usage: CapabilityUsageEntry[] | null;
  ledger: {
    summary: Array<{
      currency: string | null;
      billing_account_id: string | null;
      tenant_payable_microunits: string | null;
      last_occurred_at: string | null;
    }>;
    entries: CapabilityUsageEntry[];
  } | null;
  assignment?: {
    membership_id: string | null;
    capability_id: string | null;
    capability_version: string | null;
    decision: "deny";
    assigned_by_membership_id: string | null;
    created_at: string | null;
    updated_at: string | null;
  } | null;
}

export interface TenantCapabilitySubaccountUpdateInput {
  currency: string;
  limit_microunits: string;
  status?: "active" | "paused";
}

export interface TenantCapabilityMemberAssignmentUpdateInput {
  capability_id: string;
  capability_version: string;
  decision: "deny";
}

export interface TenantAuditEvent {
  id: string;
  actor_user_id: string;
  action: string;
  resource_type: string;
  resource_id: string;
  decision: "allowed" | "denied" | "failed";
  created_at: string;
}
export type MatterStage =
  | "intake"
  | "analysis"
  | "drafting"
  | "litigation"
  | "closed";
export type MatterClassification = "normal" | "sensitive" | "highly_sensitive";
export type MatterStatus = "active" | "archived" | "legal_hold";
export type MatterKind =
  | "case"
  | "consultation"
  | "contract_review"
  | "legal_research"
  | "document_drafting"
  | "other_legal";
export type MatterMemberRole =
  | "owner"
  | "lead"
  | "lawyer"
  | "assistant"
  | "viewer";
export type EvidenceStatus = "active" | "archived";
export type EvidenceScanStatus = "pending" | "clean" | "infected" | "error";
export type OcrJobStatus =
  | "queued"
  | "processing"
  | "succeeded"
  | "failed"
  | "cancelled";
export type OcrSourceState =
  | "available"
  | "archived"
  | "legal_hold"
  | "purge_pending"
  | "purge_failed"
  | "purged";

export type OcrProviderId = "local_ppv6" | "mineru_online";

export interface OcrProviderSettings {
  id: OcrProviderId;
  name: string;
  configured: boolean;
  endpoint: string | null;
  credential_configured: boolean;
  processing_location: "user_managed" | "third_party_cloud";
}

export interface OcrUserSettings {
  default_provider: OcrProviderId;
  version: number;
  providers: OcrProviderSettings[];
  worker_available: boolean;
}

export interface PersonalMineruCredential {
  configured: boolean;
  masked_key: string | null;
  status:
    | "not_configured"
    | "unverified"
    | "auth_accepted"
    | "invalid"
    | "revoked";
  quota_visibility: "unavailable";
  remaining_pages: null;
  version: number;
  credential_version: number;
  endpoint: "https://mineru.net";
  execution_available: boolean;
  completed_pages_in_this_system?: number;
}

export interface UpdateOcrUserSettingsInput {
  default_provider: OcrProviderId;
  local_endpoint: string | null;
  local_access_token?: string;
  clear_local_access_token?: boolean;
  mineru_api_key?: string;
  clear_mineru_api_key?: boolean;
  expected_version: number;
}

export interface Tenant {
  id: string;
  slug: string;
  name: string;
  status: string;
  version: number;
  created_at: string;
  updated_at: string;
}

export interface Membership {
  id: string;
  tenant_id: string;
  user_id: string;
  role: TenantRole;
  status: string;
  display_name: string | null;
  joined_at: string | null;
  left_at: string | null;
  invitation_expires_at: string | null;
  version: number;
  created_at: string;
  updated_at: string;
}

export interface TenantListItem {
  tenant: Tenant;
  membership: Membership;
}

export interface Matter {
  id: string;
  tenant_id: string;
  kind: MatterKind;
  case_number: string | null;
  title: string;
  cause: string | null;
  stage: MatterStage;
  status: MatterStatus;
  classification: MatterClassification;
  created_by_membership_id: string;
  version: number;
  created_at: string;
  updated_at: string;
}

export interface CaseWorkbenchDeadline {
  id: string;
  kind: MatterDeadlineKind;
  title: string;
  state: MatterDeadlineState;
  due_at: string;
  timezone_name: string;
  version: number;
}

export interface CaseWorkbenchDeadlinePage {
  items: CaseWorkbenchDeadline[];
  total: number;
  limit: number;
  offset: number;
  next_offset: number | null;
}

export interface CaseWorkbenchActivity {
  action: string;
  resource_type: string;
  resource_id: string;
  created_at: string;
}

export interface CaseWorkbenchOverview {
  revision: number;
  matter: Pick<
    Matter,
    | "id"
    | "title"
    | "case_number"
    | "cause"
    | "kind"
    | "stage"
    | "status"
    | "classification"
    | "version"
    | "updated_at"
  >;
  permissions: {
    can_edit: boolean;
    can_review_documents: boolean;
    member_role: MatterMemberRole;
  };
  statistics: {
    evidence_items: number;
    derived_artifacts: number;
    clean_scanned_current_materials: number;
    pending_document_reviews: number;
    current_artifacts: Array<{
      kind: string;
      review_status: string;
      count: number;
    }>;
    overdue_confirmed_deadlines: number;
    confirmed_deadlines_next_7_days: number;
    confirmed_internal_tasks: number;
    completed_internal_tasks: number;
    proposed_deadlines: number;
  };
  upcoming_deadlines: CaseWorkbenchDeadline[];
  recent_activity: CaseWorkbenchActivity[];
  generated_at: string;
}

export interface MatterLegalHoldEvent {
  id: string;
  sequence_number: number;
  event_type: "placed" | "released";
  previous_status: "active" | "archived" | null;
  referenced_event_id: string | null;
  reason_note: string;
  reason_sha256: string;
  created_by_membership_id: string;
  created_at: string;
}

export interface MatterLegalHoldView {
  active: boolean;
  matter_version: number;
  events: MatterLegalHoldEvent[];
}

export interface SetMatterLegalHoldInput {
  active: boolean;
  reason: string;
  expected_version: number;
}

export interface MatterMember {
  id: string;
  tenant_id: string;
  matter_id: string;
  membership_id: string;
  role: MatterMemberRole;
  status: string;
  version: number;
  created_at: string;
  updated_at: string;
}

export interface MatterThread {
  id: string;
  tenant_id: string;
  matter_id: string;
  thread_id: string;
  created_by_membership_id: string;
  purpose: string;
  status: string;
  version: number;
  created_at: string;
  updated_at: string;
}

export interface TrustedMatterContext {
  user_id: string;
  tenant_id: string;
  membership_id: string;
  tenant_role: TenantRole;
  matter_id: string;
  work_kind: MatterKind;
  matter_member_id: string;
  matter_role: MatterMemberRole;
  thread_id: string;
  mapping_id: string;
  policy_version: string;
  context_version: number;
}

export type ProjectArtifactKind =
  | "document"
  | "note"
  | "legal_research"
  | "knowledge_graph"
  | "timeline"
  | "contract_review"
  | "transcript"
  | "case_analysis"
  | "litigation_strategy"
  | "other";

export interface ProjectArtifact {
  id: string;
  tenant_id: string;
  matter_id: string;
  kind: ProjectArtifactKind;
  title: string;
  status: "active" | "archived";
  current_version_number: number;
  version: number;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
}

export interface ProjectArtifactVersion {
  id: string;
  tenant_id: string;
  matter_id: string;
  project_artifact_id: string;
  version_number: number;
  source_thread_id: string | null;
  source_artifact_path: string | null;
  source_revision_sha256: string;
  source_provenance: "client_asserted" | "workspace_editor";
  derived_from_version_id: string | null;
  source_manifest: Record<string, unknown> | null;
  original_filename: string;
  media_type: string;
  byte_size: number;
  sha256: string;
  review_status: "unreviewed" | "reviewed" | "approved";
  latest_review?: ProjectArtifactReview | null;
  created_at: string;
}

export interface ProjectArtifactSourceReceipt {
  artifact_id: string;
  version_id: string;
  version_number: number;
  version_sha256: string;
  source_provenance: "client_asserted" | "workspace_editor";
  source_manifest: Record<string, unknown> | null;
  source_manifest_sha256: string | null;
  source_state: "bound" | "not_recorded";
}

export type WorkProductProposalStatus =
  | "pending"
  | "accepted"
  | "rejected"
  | "expired";

export interface WorkProductProposal {
  id: string;
  kind: "case_analysis" | "litigation_strategy";
  project_artifact_id: string | null;
  base_version_id: string | null;
  base_artifact_version: number | null;
  base_sha256: string | null;
  derived_from_version_id: string | null;
  candidate_sha256: string;
  source_manifest_sha256: string;
  root_run_id: string;
  thread_id: string;
  manifest_id: string;
  status: WorkProductProposalStatus;
  version: number;
  expires_at: string;
  created_by_membership_id: string;
  decided_by_membership_id: string | null;
  decided_at: string | null;
  decision_note: string | null;
  selected_change_ids: string[] | null;
  result_version_id: string | null;
  created_at: string;
}

export interface WorkProductProposalChange {
  change_id: string;
  item_id: string;
  change: "added" | "modified" | "deleted";
  before: unknown;
  after: unknown;
}

export interface WorkProductProposalComparison {
  proposal: WorkProductProposal;
  is_stale: boolean;
  base: Record<string, unknown> | null;
  candidate: Record<string, unknown>;
  changes: WorkProductProposalChange[];
}

export type ProjectArtifactReviewDecision = "approved" | "changes_requested";

export interface ProjectArtifactReview {
  id: string;
  project_artifact_version_id: string;
  sequence_number: number;
  version_sha256: string;
  decision: ProjectArtifactReviewDecision;
  review_note?: string;
  reviewed_by_membership_id: string;
  created_at: string;
}

export type ProjectArtifactExportFormat = "docx" | "pdf";

export interface EvidenceItem {
  id: string;
  tenant_id: string;
  matter_id: string;
  kind: string;
  title: string;
  status: EvidenceStatus;
  created_by_membership_id: string;
  version: number;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
}

export interface EvidenceVersion {
  id: string;
  tenant_id: string;
  matter_id: string;
  evidence_item_id: string;
  version_number: number;
  origin: string;
  source_version_id: string | null;
  original_filename: string;
  media_type: string;
  byte_size: number;
  sha256: string;
  created_by_membership_id: string;
  created_at: string;
  scan_status: EvidenceScanStatus;
  scanned_at: string | null;
}

export interface OcrJob {
  id: string;
  evidence_item_id: string;
  evidence_version_id: string;
  rerun_of_ocr_job_id: string | null;
  run_number: number;
  provider: string;
  language: string;
  enable_table: boolean;
  enable_formula: boolean;
  physical_pages: number[] | null;
  page_rotations: Record<string, OcrRightAngle>;
  status: OcrJobStatus;
  attempts: number;
  max_attempts: number;
  last_error_code: string | null;
  page_count: number | null;
  cancel_requested: boolean;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export type OcrWorkflowStatus =
  | "planned"
  | "running"
  | "paused"
  | "stopping"
  | "awaiting_review"
  | "partially_completed"
  | "failed"
  | "cancelled";

export type OcrWorkflowSegmentStatus =
  | "pending"
  | "queued"
  | "processing"
  | "ready"
  | "failed"
  | "cancelled";

export type OcrWorkflowPageStatus =
  | "excluded"
  | "pending"
  | "queued"
  | "processing"
  | "ready"
  | "failed"
  | "cancelled"
  | "reused";

export interface OcrWorkflowPage {
  physical_page_number: number;
  width_points: number;
  height_points: number;
  source_rotation_degrees: OcrRightAngle;
  final_rotation_degrees: OcrRightAngle;
  selected: boolean;
  status: OcrWorkflowPageStatus;
  segment_id: string | null;
  ocr_job_id: string | null;
}

export interface OcrWorkflowSegment {
  id: string;
  sequence_number: number;
  physical_pages: number[];
  page_count: number;
  resource_source: "tenant_default" | "personal" | "platform" | string;
  provider: string;
  quota_pre_submit_confirmed: boolean;
  controlled_quote_id?: string | null;
  controlled_max_microunits?: string | null;
  status: OcrWorkflowSegmentStatus;
  ocr_job_id: string | null;
  last_error_code: string | null;
  started_at: string | null;
  completed_at: string | null;
}

export interface OcrWorkflow {
  id: string;
  evidence_item_id: string;
  evidence_version_id: string;
  source_sha256: string;
  page_count: number;
  selected_page_count: number;
  target_segment_pages: number;
  plan_revision: number;
  execution_generation: number;
  provider: string;
  language: string;
  enable_table: boolean;
  enable_formula: boolean;
  resource_source: "tenant_default" | "personal" | "platform" | string;
  status: OcrWorkflowStatus;
  ready_pages: number;
  terminal_pages: number;
  failed_pages: number;
  cancel_requested: boolean;
  version: number;
  latest_event_seq: number;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
  pages: OcrWorkflowPage[];
  segments: OcrWorkflowSegment[];
}

export interface OcrWorkflowEvent {
  seq: number;
  event_type: string;
  payload: Record<string, unknown>;
  created_at: string;
}

export interface OcrPageDraft {
  id: string | null;
  physical_page_number: number;
  source_ocr_job_id: string;
  source_ocr_result_id: string;
  source_ocr_page_id: string;
  source_text_sha256: string;
  source_block_ids: string[];
  markdown_text: string;
  markdown_sha256: string;
  status: "draft" | "reviewed";
  version: number;
  source_changed: boolean;
  reviewed_at: string | null;
  created_at: string | null;
  updated_at: string | null;
}

export interface OcrPageDraftHead {
  id: string;
  physical_page_number: number;
  source_ocr_job_id: string;
  source_ocr_result_id: string;
  source_ocr_page_id: string;
  source_text_sha256: string;
  source_block_ids: string[];
  markdown_sha256: string;
  status: "draft" | "reviewed";
  version: number;
  reviewed_at: string | null;
  updated_at: string;
}

export interface OcrProofreadingPublicationSummary {
  id: string;
  publication_number: number;
  status: "complete" | "partial";
  page_count: number;
  reviewed_page_count: number;
  recognized_page_numbers: number[];
  missing_page_numbers: number[];
  markdown_sha256: string;
  manifest_sha256: string;
  created_at: string;
}

export interface OcrProofreadingPublicationPage {
  physical_page_number: number;
  draft_id: string;
  draft_revision_number: number;
  draft_status: "draft" | "reviewed";
  markdown_sha256: string;
  markdown_start_character: number;
  markdown_end_character: number;
  source_ocr_job_id: string;
  source_ocr_result_id: string;
  source_ocr_page_id: string;
  source_text_sha256: string;
  source_block_ids: string[];
}

export interface OcrProofreadingPublicationCitationAnchor {
  publication_id: string;
  publication_number: number;
  publication_page_id: string;
  start_character: number;
  end_character: number;
  page_markdown_sha256: string;
}

export interface OcrProofreadingPublication extends OcrProofreadingPublicationSummary {
  markdown_text: string;
  manifest: Record<string, unknown> & {
    cross_page_tables?: OcrCrossPageTableProjection[];
  };
  pages: OcrProofreadingPublicationPage[];
}

export interface OcrTableMergeSelection {
  physical_page_number: number;
  source_block_id: string;
  start_character: number;
  end_character: number;
}

export interface OcrCrossPageTableProjection {
  markdown_text: string;
  markdown_sha256: string;
  header_row_count?: number;
  source_pages: number[];
  source_ocr_page_ids: string[];
  source_block_ids: string[];
  sources_edited_against_ocr: boolean[];
  rows: Array<{
    merged_row_number: number;
    physical_page_number: number;
    source_ocr_page_id: string;
    source_block_id: string;
    draft_revision_number: number;
    start_character: number;
    end_character: number;
    cells?: Array<{
      column: number;
      column_span: number;
      text: string;
      start_character: number;
      end_character: number;
      continued_from_prior_row: boolean;
      citable: boolean;
    }>;
  }>;
}

export interface OcrProofreadingCollection {
  ocr_page_drafts: OcrPageDraftHead[];
  expected_page_numbers: number[];
  recognized_page_numbers: number[];
  missing_page_numbers: number[];
  latest_publication: OcrProofreadingPublicationSummary | null;
}

export type OcrRightAngle = 0 | 90 | 180 | 270;

export interface OcrCoordinateSpace {
  version: string;
  canvas_width_pixels: number;
  canvas_height_pixels: number;
  source_rotation_degrees: OcrRightAngle;
  orientation_correction_degrees: OcrRightAngle;
  source_to_canvas_transform: [number, number, number, number, number, number];
  canvas_to_source_transform: [number, number, number, number, number, number];
}

export interface OcrPageSummary {
  physical_page_number: number;
  scan_page_number: number | null;
  printed_page_label: string | null;
  width_points: number | null;
  height_points: number | null;
  rotation_degrees: number;
  coordinate_space: OcrCoordinateSpace | null;
  block_count: number;
}

export interface OcrResult {
  id: string;
  ocr_job_id: string;
  evidence_version_id: string;
  attempt: number;
  provider: string;
  model_version: string;
  language: string;
  page_count: number;
  created_at: string;
  pages: OcrPageSummary[];
}

export interface OcrDocumentRevisionPage {
  physical_page_number: number;
  ocr_job_id: string;
  ocr_result_id: string;
  ocr_page_id: string;
}

export interface OcrDocumentRevision {
  id: string;
  revision_number: number;
  base_revision_id: string | null;
  adopted_ocr_job_id: string;
  created_at: string;
  pages: OcrDocumentRevisionPage[];
}

export interface OcrDocumentRevisionState {
  version: number;
  current_revision: OcrDocumentRevision | null;
}

export interface OcrBlockBounds {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export type OcrBlockReviewStatus =
  | "not_required"
  | "pending"
  | "partially_verified"
  | "verified"
  | "rejected";

export interface OcrBlockQuality {
  review_required: boolean;
  warnings?: string[];
  threshold: number;
  status: OcrBlockReviewStatus;
  verification_count: number;
  required_verifications: number;
  current_reviewer_has_verified: boolean;
  review_number: number | null;
  reviewed_at: string | null;
}

export interface OcrBlockReview {
  id: string;
  ocr_block_id: string;
  decision: "verified" | "rejected";
  review_number: number;
  created_at: string;
}

export type OcrBlockCorrectionStatus =
  | "pending"
  | "accepted"
  | "rejected"
  | "escalated";

export interface OcrBlockCorrectionReview {
  id: string;
  decision: Exclude<OcrBlockCorrectionStatus, "pending">;
  comment: string | null;
  review_number: number;
  created_at: string;
}

export interface OcrBlockCorrection {
  id: string;
  ocr_block_id: string;
  correction_number: number;
  base_correction_id: string | null;
  base_text: string;
  base_text_sha256: string;
  corrected_text: string;
  corrected_text_sha256: string;
  reason: string;
  status: OcrBlockCorrectionStatus;
  can_current_user_review: boolean;
  created_at: string;
  latest_review: OcrBlockCorrectionReview | null;
}

export interface OcrBlockCorrectionState {
  effective_text: string;
  effective_correction_id: string | null;
  latest_status: OcrBlockCorrectionStatus | "none";
  items: OcrBlockCorrection[];
}

export interface OcrTableCell {
  row: number;
  column: number;
  row_span: number;
  column_span: number;
  text: string;
}

export type OcrBlockStructure =
  | {
      type: "table";
      rows: number;
      columns: number;
      cells: OcrTableCell[];
    }
  | { type: "formula"; latex: string };

export interface OcrBlock {
  id: string;
  block_index: number;
  reading_order: number;
  kind: string;
  text: string;
  bbox: OcrBlockBounds | null;
  confidence: number | null;
  structure: OcrBlockStructure | null;
  quality: OcrBlockQuality;
  correction: OcrBlockCorrectionState;
}

export interface OcrFormulaOpinion {
  formula_opinion_id: string;
  formula_opinion: {
    version: "matrix-ocr-formula-opinion-v1";
    source_sha256: string;
    crop_sha256: string;
    physical_page_number: number;
    bbox: [number, number, number, number];
    orientation_correction_degrees: number;
    model_version: string;
    formula_model: string;
    latex: string;
    width_pixels: number;
    height_pixels: number;
  };
  ocr_job_id: string;
  ocr_result_id: string;
  ocr_block_id: string;
  evidence_version_id: string;
  ocr_block_text_sha256: string;
}

export interface OcrTableOpinion {
  table_opinion_id: string;
  table_opinion: {
    version: "matrix-ocr-table-opinion-v1";
    source_sha256: string;
    crop_sha256: string;
    physical_page_number: number;
    bbox: [number, number, number, number];
    orientation_correction_degrees: number;
    model_version: string;
    table_model: string;
    html: string;
    structure: {
      type: "table";
      rows: number;
      columns: number;
      cells: Array<{
        row: number;
        column: number;
        row_span: number;
        column_span: number;
        text: string;
      }>;
    };
    width_pixels: number;
    height_pixels: number;
  };
  ocr_job_id: string;
  ocr_result_id: string;
  ocr_block_id: string;
  evidence_version_id: string;
  ocr_block_text_sha256: string;
}

export interface OcrReviewQueueEntry {
  evidence_item_id: string;
  evidence_version_id: string;
  ocr_job_id: string;
  ocr_result_id: string;
  physical_page_number: number;
  block: Omit<OcrBlock, "bbox">;
}

export interface OcrPage extends OcrPageSummary {
  ocr_result_id: string;
  evidence_version_id: string;
  text: string;
  blocks: OcrBlock[];
  formula_opinion_available?: boolean;
  formula_opinion_history_available?: boolean;
  table_opinion_available?: boolean;
  table_opinion_history_available?: boolean;
}

export interface OcrCitationAnchor {
  start_block_id: string;
  end_block_id: string;
  start_offset: number;
  end_offset: number;
}

export interface OcrCitationViewerLocation {
  page_index: number;
  physical_page_number: number;
  scan_page_number: number | null;
  printed_page_label: string | null;
  rotation_degrees: number;
  start_bbox: OcrBlockBounds | null;
  end_bbox: OcrBlockBounds | null;
}

export interface OcrCitationBlockSource {
  source_index: number;
  ocr_block_id: string;
  correction_id: string | null;
  text_sha256: string;
}

export interface OcrCitation {
  id: string;
  source_type: "ocr_block" | "proofreading_publication";
  evidence_item_id: string;
  evidence_version_id: string;
  ocr_job_id: string;
  ocr_result_id: string;
  ocr_page_id: string;
  physical_page_number: number;
  anchor: OcrCitationAnchor | null;
  publication_anchor: OcrProofreadingPublicationCitationAnchor | null;
  viewer_location: OcrCitationViewerLocation;
  source_state: OcrSourceState;
  text_basis:
    | "ocr"
    | "corrected"
    | "mixed"
    | "legacy_ocr"
    | "proofread_markdown";
  block_sources: OcrCitationBlockSource[];
  source_block_ids: string[];
  ocr_result_state: "current" | "superseded" | "published_snapshot";
  latest_ocr_result_id: string | null;
  publication_state: "current" | "superseded" | null;
  latest_publication_id: string | null;
  created_at: string;
  quote_text?: string;
  quote_preview?: string;
}

export interface ActivateTenantInput {
  activation_code: string;
}

export interface RegisterLawFirmInput {
  organization_name: string;
  desired_slug: string;
  license_number?: string;
  owner_display_name?: string;
  contact_phone?: string;
  requested_plan_code: string;
}

export interface LawFirmRegistrationReceipt {
  registration_id: string;
  tenant_id: string;
  organization_name: string;
  desired_slug: string;
  status: "submitted";
}

export interface CreateMatterInput {
  kind: MatterKind;
  case_number?: string;
  title: string;
  cause?: string;
  stage: MatterStage;
  classification: MatterClassification;
}

export interface CreatedMatterConversation {
  threadId: string;
  mapping: MatterThread;
}

export interface UploadEvidenceInput {
  title: string;
  file: File;
}

export interface ScheduleOcrInput {
  provider?: string;
  language: string;
  enable_table: boolean;
  enable_formula: boolean;
  physical_pages?: number[];
  page_rotations?: Record<string, OcrRightAngle>;
}

export interface PlanOcrWorkflowInput {
  resource_source?: "tenant_default" | "personal_mineru" | "platform_ocr";
  language: string;
  enable_table: boolean;
  enable_formula: boolean;
  selected_pages?: number[];
  page_rotations?: Record<string, OcrRightAngle>;
  target_segment_pages: number;
}

export interface RerunOcrInput {
  ocr_job_id: string;
  physical_pages?: number[];
  page_rotations?: Record<string, OcrRightAngle>;
}

export type CreateCitationInput =
  | {
      source_type?: "ocr_block";
      ocr_result_id: string;
      physical_page_number: number;
      start_block_id: string;
      end_block_id?: string;
      start_offset?: number;
      end_offset?: number;
    }
  | {
      source_type: "proofreading_publication";
      publication_id: string;
      physical_page_number: number;
      start_character: number;
      end_character: number;
    };

export interface ProposeOcrCorrectionInput {
  corrected_text: string;
  reason: string;
}

export interface ReviewOcrCorrectionInput {
  decision: Exclude<OcrBlockCorrectionStatus, "pending">;
  comment?: string;
}

export type MatterMemoryStatus =
  | "proposed"
  | "approved"
  | "rejected"
  | "archived";

export interface MatterMemorySource {
  citation_id: string;
  evidence_item_id: string;
  evidence_title: string | null;
  evidence_version_id: string;
  evidence_sha256: string | null;
  publication_id: string;
  publication_number: number;
  publication_state: "current" | "superseded";
  publication_sha256: string;
  publication_manifest_sha256: string;
  physical_page_number: number;
  page_sha256: string;
  quote_text: string;
  quote_sha256: string;
  source_state: OcrSourceState;
}

export interface MatterMemoryEntry {
  id: string;
  title: string;
  content: string;
  content_sha256: string;
  status: MatterMemoryStatus;
  version: number;
  decision_note: string | null;
  decided_at: string | null;
  created_at: string;
  sources: MatterMemorySource[];
}

export interface MatterMemoryCollection {
  items: MatterMemoryEntry[];
  can_review: boolean;
}

export interface DecideMatterMemoryInput {
  decision: Exclude<MatterMemoryStatus, "proposed">;
  note?: string;
  expected_version: number;
}

export interface MatterMemoryDecisionReceipt {
  memory_entry_id: string;
  decision: Exclude<MatterMemoryStatus, "proposed">;
  version: number;
  decided_at: string;
}

export type MatterDeadlineKind =
  | "filing"
  | "hearing"
  | "performance"
  | "internal_task";
export type MatterDeadlineState =
  | "proposed"
  | "confirmed"
  | "cancelled"
  | "completed";
export type MatterDeadlineOrigin =
  | "agent_candidate"
  | "lawyer_entry"
  | "imported";
export type MatterNotificationChannel = "in_app" | "email" | "wecom";
export type MatterNotificationStatus =
  | "pending"
  | "sending"
  | "sent"
  | "failed"
  | "cancelled";

export interface MatterDeadline {
  id: string;
  tenant_id: string;
  matter_id: string;
  kind: MatterDeadlineKind;
  title: string;
  origin: MatterDeadlineOrigin;
  state: MatterDeadlineState;
  local_due_at: string;
  timezone_name: string;
  fold: 0 | 1 | null;
  due_at: string;
  basis_note: string;
  rule_version: string;
  source_refs: string[];
  calculation: Record<string, unknown>;
  created_by_membership_id: string;
  confirmed_by_membership_id: string | null;
  confirmed_at: string | null;
  version: number;
  created_at: string;
  updated_at: string;
}

export interface MatterDeadlineRecipient {
  membership_id: string;
  role: MatterMemberRole;
  display_name: string | null;
}

export interface MatterDeadlineEvent {
  id: string;
  deadline_id: string;
  sequence_number: number;
  event_type: MatterDeadlineState | "rescheduled";
  event: Record<string, unknown>;
  actor_membership_id: string;
  created_at: string;
}

export interface MatterNotificationOutboxItem {
  id: string;
  deadline_id: string;
  deadline_version: number;
  recipient_membership_id: string;
  channel: MatterNotificationChannel;
  scheduled_at: string;
  status: MatterNotificationStatus;
  sent_at: string | null;
  read_at: string | null;
}

export interface CreateMatterDeadlineInput {
  kind: MatterDeadlineKind;
  title: string;
  origin: MatterDeadlineOrigin;
  local_due_at: string;
  timezone_name: string;
  fold?: 0 | 1 | null;
  basis_note: string;
  rule_version: string;
  source_refs: string[];
  calculation: Record<string, unknown>;
}

export interface ConfirmMatterDeadlineInput {
  expected_version: number;
  recipient_membership_ids: string[];
  reminder_offsets_minutes: number[];
  channels: MatterNotificationChannel[];
}

export interface RescheduleMatterDeadlineInput {
  expected_version: number;
  local_due_at: string;
  timezone_name: string;
  fold?: 0 | 1 | null;
  basis_note: string;
  rule_version: string;
  source_refs: string[];
  calculation: Record<string, unknown>;
  change_note: string;
  recipient_membership_ids: string[];
  reminder_offsets_minutes: number[];
  channels: MatterNotificationChannel[];
}

export interface TransitionMatterDeadlineInput {
  expected_version: number;
  change_note: string;
}

export type SpeechTranscriptionStatus =
  | "queued"
  | "processing"
  | "awaiting_review"
  | "reviewed"
  | "failed"
  | "cancelled";

export interface SpeechTranscriptionTask {
  id: string;
  tenant_id: string;
  matter_id: string;
  evidence_item_id: string;
  evidence_version_id: string;
  source_sha256: string;
  media_type: string;
  requested_by_membership_id: string;
  status: SpeechTranscriptionStatus;
  attempts: number;
  current_version_number: number;
  model_id: string | null;
  error_code: string | null;
  cancel_requested: boolean;
  created_at: string;
  updated_at: string;
}

export interface SpeechTranscriptSegment {
  text: string;
  charStart: number;
  charEnd: number;
  startMs: number;
  endMs: number;
  speakerId?: string | null;
}

export interface SpeechTranscriptSpeaker {
  id: string;
  label: string;
}

export interface SpeechTranscript {
  schemaVersion: number;
  text: string;
  durationMs: number;
  language?: string;
  modelId?: string;
  reviewStatus: "unreviewed" | "lawyer_reviewed";
  segments: SpeechTranscriptSegment[];
  speakers: SpeechTranscriptSpeaker[];
  alignment?: string;
  approxAlignment?: boolean;
  warnings?: string[];
  source?: {
    sha256: string;
    byteLength: number;
    mediaType: string;
  };
}

export interface SpeechTranscriptVersion {
  id: string;
  task_id: string;
  version_number: number;
  origin: "asr" | "lawyer_review";
  source_sha256: string;
  transcript: SpeechTranscript;
  actor_membership_id: string;
  created_at: string;
}

export interface SpeechTranscriptionEvent {
  id: string;
  task_id: string;
  sequence_number: number;
  event_type: string;
  event: Record<string, unknown>;
  actor_membership_id: string;
  created_at: string;
}

export interface SpeechTranscriptionCollection {
  items: SpeechTranscriptionTask[];
  transcription_available: boolean;
  supported_media_types: string[];
  live_capture_available: boolean;
  live_capture_media_types: string[];
}

export interface SpeechCaptureSession {
  id: string;
  tenant_id: string;
  matter_id: string;
  created_by_membership_id: string;
  title: string;
  original_filename: string;
  media_type: string;
  status: "open" | "completed" | "failed" | "cancelled" | "expired";
  next_sequence_number: number;
  total_byte_size: number;
  expires_at: string;
  cleanup_pending: boolean;
  evidence_item_id: string | null;
  evidence_version_id: string | null;
  source_sha256: string | null;
  error_code: string | null;
  created_at: string;
  updated_at: string;
}

export interface SpeechCaptureCreateReceipt extends SpeechCaptureSession {
  max_chunk_bytes: number;
  max_total_bytes: number;
  transcription_available: boolean;
}

export interface SpeechCaptureChunkReceipt {
  capture_id: string;
  accepted_sequence_number: number;
  next_sequence_number: number;
  chunk_sha256: string;
}

export interface SpeechCaptureFinishReceipt extends SpeechCaptureSession {
  evidence_item?: EvidenceItem;
  evidence_version?: EvidenceVersion;
}

export interface SpeechTranscriptionDetail {
  task: SpeechTranscriptionTask;
  versions: SpeechTranscriptVersion[];
  events: SpeechTranscriptionEvent[];
}

export interface ReviewSpeechTranscriptInput {
  expected_version: number;
  text: string;
  segments: SpeechTranscriptSegment[];
  speakers: SpeechTranscriptSpeaker[];
}

export interface ReviewSpeechTranscriptReceipt {
  task: SpeechTranscriptionTask;
  version: SpeechTranscriptVersion;
}

export type LegalAuthorityReviewDecision =
  | "current_on_date"
  | "historical_on_date"
  | "not_effective_on_date"
  | "repealed_on_date"
  | "source_rejected"
  | "needs_review";

export interface LegalAuthorityReview {
  decision: LegalAuthorityReviewDecision;
  jurisdiction: string | null;
  relevant_on: string | null;
  basis_note: string;
  reviewed_by_membership_id: string;
  reviewed_by_display_name?: string | null;
  reviewer_matter_role?: string | null;
  reviewed_at: string;
}

export interface LegalAuthorityVersionSummary {
  id: string;
  version_number: number;
  source_sha256: string;
  content_sha256: string;
  title: string;
  issuer: string | null;
  document_type: string | null;
  source_validity_label: string | null;
  promulgated_on: string | null;
  effective_on: string | null;
  completeness: "unknown" | "partial" | "claimed_complete";
  retrieved_at: string;
  created_at: string;
  snippet: string;
  lawyer_review?: LegalAuthorityReview | null;
  summaries?: LegalAuthoritySummary[];
}

export interface LegalAuthoritySummary {
  id: string;
  sequence_number: number;
  summary_text: string;
  summary_sha256: string;
  source_content_sha256: string;
  authored_by_membership_id: string;
  created_at: string;
}

export interface LegalAuthorityDocumentView {
  id: string;
  source_key: "npc_nlrd" | "moj_admin_regs";
  source_record_id: string;
  official_url: string;
  reuse_permission_state: "unverified";
  created_at: string;
  is_favorite: boolean;
  latest_version: LegalAuthorityVersionSummary | null;
  latest_summary: LegalAuthoritySummary | null;
  lawyer_review: LegalAuthorityReview | null;
  validity_state: "unverified" | "lawyer_reviewed_for_date";
}

export interface LegalAuthorityCollection {
  items: LegalAuthorityDocumentView[];
  can_edit: boolean;
  can_review?: boolean;
}

export interface LegalAuthorityCaptureReceipt {
  document_id: string;
  official_url: string;
  reuse_permission_state: "unverified";
  version: LegalAuthorityVersionSummary;
  unchanged: boolean;
  validity_state: "unverified";
}

export interface LegalAuthorityVersionContent {
  document_id: string;
  source_key: "npc_nlrd" | "moj_admin_regs";
  source_record_id: string;
  official_url: string;
  reuse_permission_state: "unverified";
  version: Omit<LegalAuthorityVersionSummary, "snippet" | "lawyer_review">;
  text_chunk: string;
  total_chars: number;
  offset: number;
  next_offset: number | null;
  lawyer_review: LegalAuthorityReview | null;
}

export interface CreateLegalAuthorityReviewInput {
  decision: LegalAuthorityReviewDecision;
  jurisdiction?: string;
  relevant_on?: string;
  basis_note: string;
}

export interface CreateLegalAuthoritySummaryInput {
  summary_text: string;
  source_content_sha256: string;
}
