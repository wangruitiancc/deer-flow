export const LAW_MATTER_ACCESS_REVOKED_EVENT =
  "matrix-law:matter-access-revoked";

export type LawMatterAccessRevokedDetail = {
  tenantId: string;
  matterId: string;
};

export function publishLawMatterAccessRevoked(
  tenantId: string,
  matterId: string,
) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<LawMatterAccessRevokedDetail>(
      LAW_MATTER_ACCESS_REVOKED_EVENT,
      { detail: { tenantId, matterId } },
    ),
  );
}
