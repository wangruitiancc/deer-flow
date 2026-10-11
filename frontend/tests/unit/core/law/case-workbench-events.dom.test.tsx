import { afterEach, beforeEach, describe, expect, it, rs } from "@rstest/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import type { PropsWithChildren } from "react";

import * as lawApi from "@/core/law/api";
import { useLawCaseWorkbenchEvents } from "@/core/law/hooks";
import { LAW_MATTER_ACCESS_REVOKED_EVENT } from "@/core/law/speech-capture-access-events";

const tenantId = "tenant-w11";
const matterId = "matter-w11";

function revokedEventResponse(): Response {
  let sent = false;
  return {
    body: {
      getReader: () => ({
        read: async () => {
          if (sent) return { done: true, value: undefined };
          sent = true;
          return {
            done: false,
            value: new TextEncoder().encode("event: revoked\ndata: {}\n\n"),
          };
        },
      }),
    },
  } as unknown as Response;
}

describe("case workbench access revocation events", () => {
  const openStream = rs.spyOn(lawApi, "openCaseWorkbenchEventStream");

  beforeEach(() => {
    openStream.mockReset();
    openStream.mockResolvedValue(revokedEventResponse());
  });

  afterEach(() => cleanup());

  it("notifies matching matter listeners and clears their cached queries", async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const matterKey = ["law", tenantId, matterId, "sensitive"];
    const otherMatterKey = ["law", tenantId, "other-matter", "sensitive"];
    client.setQueryData(matterKey, { marker: "matter-data" });
    client.setQueryData(otherMatterKey, { marker: "other-matter-data" });
    const wrapper = ({ children }: PropsWithChildren) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const revoked = new Promise<CustomEvent<{ tenantId: string; matterId: string }>>(
      (resolve) => {
        window.addEventListener(
          LAW_MATTER_ACCESS_REVOKED_EVENT,
          (event) => resolve(event as CustomEvent),
          { once: true },
        );
      },
    );

    const { unmount } = renderHook(
      () => useLawCaseWorkbenchEvents(tenantId, matterId, 7),
      { wrapper },
    );

    await expect(revoked).resolves.toMatchObject({
      detail: { tenantId, matterId },
    });
    await waitFor(() => expect(client.getQueryData(matterKey)).toBeUndefined());
    expect(client.getQueryData(otherMatterKey)).toEqual({
      marker: "other-matter-data",
    });
    expect(openStream).toHaveBeenCalledTimes(1);
    unmount();
    client.clear();
  });
});
