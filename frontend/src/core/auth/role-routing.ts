import type { User } from "./types";

export function getAuthenticatedHomePath(
  user: Pick<User, "system_role">,
): "/admin" | "/workspace/law" {
  return user.system_role === "admin" ? "/admin" : "/workspace/law";
}

export function resolveAuthenticatedDestination(
  user: Pick<User, "system_role">,
  requestedPath: string,
): string {
  return user.system_role === "admin" ? "/admin" : requestedPath;
}
