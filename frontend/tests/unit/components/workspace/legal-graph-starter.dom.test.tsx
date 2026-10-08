import { afterEach, beforeEach, expect, it, rs } from "@rstest/core";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";

rs.mock("sonner", () => ({ toast: { success: rs.fn(), error: rs.fn() } }));
rs.mock("@/components/workspace/artifacts/context", () => ({
  useArtifacts: () => ({ setOpen: rs.fn() }),
}));
rs.mock("@/components/workspace/messages/context", () => ({
  useThread: rs.fn(),
}));
rs.mock("@/core/law", () => ({
  useLawThreadContext: rs.fn(),
  useLawMatter: rs.fn(),
  getMatterContextByThread: rs.fn(),
  getMatter: rs.fn(),
}));

import {
  PromptInputProvider,
  usePromptInputController,
} from "@/components/ai-elements/prompt-input";
import {
  LEGAL_GRAPH_START_PROMPT,
  LegalGraphStarter,
} from "@/components/workspace/law/legal-graph-starter";
import { useThread } from "@/components/workspace/messages/context";
import {
  getMatter,
  getMatterContextByThread,
  useLawMatter,
  useLawThreadContext,
} from "@/core/law";

const scope = {
  user_id: "synthetic",
  tenant_id: "tenant",
  matter_id: "matter",
  mapping_id: "binding",
  thread_id: "thread",
  matter_role: "owner",
};
let composer: ReturnType<typeof usePromptInputController>;

function Probe() {
  composer = usePromptInputController();
  return (
    <input aria-label="会话输入" value={composer.textInput.value} readOnly />
  );
}

function mount(initialInput = "") {
  return render(
    <PromptInputProvider initialInput={initialInput}>
      <Probe />
      <LegalGraphStarter threadId="thread" />
    </PromptInputProvider>,
  );
}

beforeEach(() => {
  rs.clearAllMocks();
  rs.mocked(useThread).mockReturnValue({
    thread: { isLoading: false },
    isMock: false,
  } as never);
  rs.mocked(useLawThreadContext).mockReturnValue({
    data: scope,
    isError: false,
  } as never);
  rs.mocked(useLawMatter).mockReturnValue({
    data: { status: "active", title: "合成项目" },
    isError: false,
  } as never);
  rs.mocked(getMatterContextByThread).mockResolvedValue(scope as never);
  rs.mocked(getMatter).mockResolvedValue({ status: "active" } as never);
});

afterEach(() => {
  cleanup();
  rs.restoreAllMocks();
});

it("stages an explicit managed graph Skill draft after fresh authorization", async () => {
  mount();
  fireEvent.click(screen.getByRole("button", { name: "生成案情图谱" }));
  await waitFor(() =>
    expect(composer.textInput.value).toBe(LEGAL_GRAPH_START_PROMPT),
  );
  expect(composer.textInput.value).toMatch(/^\/matrix-law-graph /);
  expect(composer.attachments.files).toHaveLength(0);
  expect(getMatterContextByThread).toHaveBeenCalledTimes(1);
  expect(getMatter).toHaveBeenCalledTimes(1);
});

it("never overwrites an existing draft", async () => {
  const { toast } = await import("sonner");
  mount("保留原稿");
  fireEvent.click(screen.getByRole("button", { name: "生成案情图谱" }));
  await waitFor(() =>
    expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/未覆盖/)),
  );
  expect(composer.textInput.value).toBe("保留原稿");
  expect(getMatterContextByThread).not.toHaveBeenCalled();
});

it("rejects a role changed during the fresh authorization check", async () => {
  const { toast } = await import("sonner");
  rs.mocked(getMatterContextByThread).mockResolvedValue({
    ...scope,
    matter_role: "viewer",
  } as never);
  mount();
  fireEvent.click(screen.getByRole("button", { name: "生成案情图谱" }));
  await waitFor(() =>
    expect(toast.error).toHaveBeenCalledWith(
      expect.stringMatching(/权限已变化/),
    ),
  );
  expect(composer.textInput.value).toBe("");
});

it("does not apply a late authorization result after unmount", async () => {
  let resolve!: (value: never) => void;
  rs.mocked(getMatterContextByThread).mockReturnValue(
    new Promise((done) => {
      resolve = done;
    }),
  );
  const view = mount();
  fireEvent.click(screen.getByRole("button", { name: "生成案情图谱" }));
  const signal = rs.mocked(getMatterContextByThread).mock.calls[0]![1]!;
  view.unmount();
  expect(signal.aborted).toBe(true);
  await act(async () => resolve(scope as never));
  expect(composer.textInput.value).toBe("");
});
