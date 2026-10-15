import { parseAuthError } from "./types";

export * from "./setup-status";

export function isSystemAlreadyInitializedError(data: unknown): boolean {
  return parseAuthError(data).code === "system_already_initialized";
}
