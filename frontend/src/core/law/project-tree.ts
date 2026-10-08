import type { Matter } from "./types";

export function pathOfLawProject(tenantId: string, matterId: string): string {
  const params = new URLSearchParams({ tenant: tenantId, matter: matterId });
  return `/workspace/law?${params.toString()}`;
}

export function pathOfNewLawProject(tenantId: string | null): string {
  const params = new URLSearchParams({ new: "project" });
  if (tenantId) params.set("tenant", tenantId);
  return `/workspace/law?${params.toString()}`;
}

function normalized(value: string | null | undefined): string {
  return value?.trim().toLocaleLowerCase() ?? "";
}

export function visibleLawProjects(
  matters: readonly Matter[],
  query: string,
): Matter[] {
  const needle = normalized(query);
  return matters
    .filter((matter) => matter.status !== "archived")
    .filter((matter) => {
      if (!needle) return true;
      return [matter.title, matter.case_number, matter.cause, matter.kind].some(
        (value) => normalized(value).includes(needle),
      );
    })
    .sort((left, right) => right.updated_at.localeCompare(left.updated_at));
}

export function toggleExpandedProject(
  current: ReadonlySet<string>,
  matterId: string,
): Set<string> {
  const next = new Set(current);
  if (next.has(matterId)) {
    next.delete(matterId);
  } else {
    next.add(matterId);
  }
  return next;
}
