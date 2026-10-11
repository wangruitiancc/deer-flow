type AuthSessionCleanup = () => void | Promise<void>;

const sessionCleanups = new Set<AuthSessionCleanup>();

export function registerAuthSessionCleanup(
  cleanup: AuthSessionCleanup,
): () => void {
  sessionCleanups.add(cleanup);
  return () => sessionCleanups.delete(cleanup);
}

export async function runAuthSessionCleanups(): Promise<void> {
  const pending = [...sessionCleanups].map((cleanup) => {
    try {
      return Promise.resolve(cleanup());
    } catch (error) {
      return Promise.reject(
        error instanceof Error
          ? error
          : new Error("Auth cleanup failed with a non-error value."),
      );
    }
  });
  const results = await Promise.allSettled(pending);
  if (results.some((result) => result.status === "rejected"))
    throw new Error("One or more local session cleanups failed.");
}

// Backwards-compatible aliases for callers migrated in separate commits.
export const registerAuthLogoutCleanup = registerAuthSessionCleanup;
export const runAuthLogoutCleanups = runAuthSessionCleanups;
