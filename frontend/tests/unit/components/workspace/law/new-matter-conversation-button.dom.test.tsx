import { afterEach, describe, expect, it, rs } from "@rstest/core";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";

import { NewMatterConversationButton } from "@/components/workspace/law/new-matter-conversation-button";

const mocks = rs.hoisted(() => ({
  create: rs.fn(),
  push: rs.fn(),
  error: rs.fn(),
  scope: rs.fn(),
}));
rs.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push }) }));
rs.mock("sonner", () => ({ toast: { error: mocks.error } }));
rs.mock("@/core/law", () => ({
  useCreateMatterConversation: (tenant: string, matter: string) => {
    mocks.scope(tenant, matter);
    return { mutateAsync: mocks.create, isPending: false };
  },
}));
rs.mock("@/core/threads/utils", () => ({
  pathOfThread: (id: string) => `/workspace/chats/${id}`,
}));
afterEach(() => {
  cleanup();
  rs.clearAllMocks();
});

describe("case-bound new conversation navigation", () => {
  it("starts one bound operation for a rapid double click and navigates only after its receipt", async () => {
    let finish!: (value: { threadId: string }) => void;
    mocks.create.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    render(
      <NewMatterConversationButton
        tenantId="tenant-A"
        matterId="matter-A"
        label="新建会话"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "新建会话" }));
    fireEvent.click(screen.getByRole("button", { name: "新建会话" }));
    expect(mocks.create).toHaveBeenCalledTimes(1);
    expect(mocks.scope).toHaveBeenCalledWith("tenant-A", "matter-A");
    expect(mocks.push).not.toHaveBeenCalled();
    await act(async () => {
      finish({ threadId: "bound-thread" });
    });
    expect(mocks.push).toHaveBeenCalledWith("/workspace/chats/bound-thread");
  });
  it("does not navigate a newly selected case when the old request finishes", async () => {
    let finish!: (value: { threadId: string }) => void;
    mocks.create.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const view = render(
      <NewMatterConversationButton
        key="A"
        tenantId="tenant-A"
        matterId="matter-A"
        label="新建会话"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "新建会话" }));
    view.rerender(
      <NewMatterConversationButton
        key="B"
        tenantId="tenant-A"
        matterId="matter-B"
        label="新建会话"
      />,
    );
    await act(async () => {
      finish({ threadId: "old-thread" });
    });
    expect(mocks.push).not.toHaveBeenCalled();
  });
  it("keeps a failed bind visible and allows retry without navigating an unbound thread", async () => {
    mocks.create.mockRejectedValue(new Error("binding denied"));
    render(
      <NewMatterConversationButton
        tenantId="tenant-A"
        matterId="matter-A"
        label="新建会话"
      />,
    );
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "新建会话" }));
    });
    expect(mocks.error).toHaveBeenCalledWith("binding denied");
    expect(mocks.push).not.toHaveBeenCalled();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "新建会话" }));
    });
    expect(mocks.create).toHaveBeenCalledTimes(2);
  });
});
