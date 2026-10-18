import { afterEach, describe, expect, it, rs } from "@rstest/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import type { PropsWithChildren } from "react";

import * as lawApi from "@/core/law/api";
import { useLawManagementTenants } from "@/core/law/hooks";

afterEach(() => {
  cleanup();
  rs.restoreAllMocks();
});

function setup() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const wrapper = ({ children }: PropsWithChildren) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { wrapper, client };
}

describe("management identity lookup", () => {
  it("does not query during legal loading or for an existing lawyer workspace", async () => {
    const read = rs
      .spyOn(lawApi, "listManagementTenants")
      .mockResolvedValue([]);
    const { wrapper, client } = setup();
    const { result, rerender, unmount } = renderHook(
      ({ enabled }) => useLawManagementTenants(enabled),
      { wrapper, initialProps: { enabled: false } },
    );
    expect(result.current.fetchStatus).toBe("idle");
    expect(read).not.toHaveBeenCalled();
    rerender({ enabled: true });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(read).toHaveBeenCalledTimes(1);
    unmount();
    client.clear();
  });
  it("surfaces management errors for explicit retry instead of presenting onboarding", async () => {
    const read = rs
      .spyOn(lawApi, "listManagementTenants")
      .mockRejectedValue(new Error("Unavailable"));
    const { wrapper, client } = setup();
    const { result, unmount } = renderHook(
      () => useLawManagementTenants(true),
      { wrapper },
    );
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.data).toBeUndefined();
    expect(read).toHaveBeenCalledTimes(1);
    unmount();
    client.clear();
  });
});
