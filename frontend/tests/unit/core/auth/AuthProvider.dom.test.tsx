import { afterEach, describe, expect, it, rs } from "@rstest/core";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useEffect } from "react";

rs.mock("next/navigation", () => ({
  useRouter: () => ({ push: rs.fn() }),
  usePathname: () => "/workspace",
}));

import { QueryClientProvider } from "@/components/query-client-provider";
import { AuthProvider, useAuth } from "@/core/auth/AuthProvider";
import { registerAuthSessionCleanup } from "@/core/auth/session-lifecycle";

const userA = {
  id: "user-a",
  email: "a@example.test",
  system_role: "user" as const,
  needs_setup: false,
};
const userB = {
  id: "user-b",
  email: "b@example.test",
  system_role: "user" as const,
  needs_setup: false,
};

function Probe() {
  const auth = useAuth();
  return (
    <>
      <p>{auth.user?.id ?? "signed-out"}</p>
      <button onClick={() => void auth.applyUser(userB)}>switch account</button>
      <button onClick={() => void auth.applyUser(userA)}>same account</button>
    </>
  );
}

function SensitiveCacheProbe() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const query = useQuery({
    queryKey: ["w11-sensitive-cache-probe"],
    queryFn: async () => "server value",
    enabled: false,
  });
  useEffect(() => {
    if (user?.id === userA.id)
      queryClient.setQueryData(
        ["w11-sensitive-cache-probe"],
        "private material",
      );
  }, [queryClient, user?.id]);
  return <p>{query.data ?? "cleared"}</p>;
}

afterEach(cleanup);

describe("AuthProvider sensitive session cleanup", () => {
  it("awaits cleanup before exposing a different account", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const cleanupSession = rs.fn(async () => gate);
    const unregister = registerAuthSessionCleanup(cleanupSession);
    render(
      <AuthProvider initialUser={userA}>
        <Probe />
      </AuthProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "switch account" }));
    await waitFor(() => expect(cleanupSession).toHaveBeenCalledTimes(1));
    expect(screen.getByText("user-a")).toBeTruthy();
    release();
    await screen.findByText("user-b");
    unregister();
  });

  it("does not clear sensitive state for a same-account refresh", async () => {
    const cleanupSession = rs.fn();
    const unregister = registerAuthSessionCleanup(cleanupSession);
    render(
      <AuthProvider initialUser={userA}>
        <Probe />
      </AuthProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "same account" }));
    await waitFor(() => expect(screen.getByText("user-a")).toBeTruthy());
    expect(cleanupSession).not.toHaveBeenCalled();
    unregister();
  });

  it("clears the shared query cache before account switch completes", async () => {
    render(
      <AuthProvider initialUser={userA}>
        <QueryClientProvider>
          <Probe />
          <SensitiveCacheProbe />
        </QueryClientProvider>
      </AuthProvider>,
    );

    await screen.findByText("private material");
    fireEvent.click(screen.getByRole("button", { name: "switch account" }));
    await screen.findByText("user-b");
    await screen.findByText("cleared");
  });
});
