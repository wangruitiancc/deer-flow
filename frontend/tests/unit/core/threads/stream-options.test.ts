import { afterEach, expect, test, rs } from "@rstest/core";

const warningToast = rs.fn();

async function captureThreadStreamOptions() {
  let capturedOptions: Record<string, unknown> | undefined;

  rs.resetModules();
  rs.doMock("react", () => ({
    useCallback: <T extends (...args: never[]) => unknown>(callback: T) =>
      callback,
    useEffect: () => undefined,
    useMemo: <T>(factory: () => T) => factory(),
    useRef: <T>(initialValue: T) => ({ current: initialValue }),
    useState: <T>(initialValue: T | (() => T)) => [
      typeof initialValue === "function"
        ? (initialValue as () => T)()
        : initialValue,
      rs.fn(),
    ],
  }));
  rs.doMock("@tanstack/react-query", () => ({
    useInfiniteQuery: () => ({
      data: { pages: [] },
      error: null,
      fetchNextPage: rs.fn(),
      hasNextPage: false,
      isFetchingNextPage: false,
      isLoading: false,
    }),
    useMutation: rs.fn(),
    useQuery: rs.fn(),
    useQueryClient: () => ({
      invalidateQueries: rs.fn(),
      setQueriesData: rs.fn(),
    }),
  }));
  rs.doMock("@langchain/langgraph-sdk/react", () => ({
    useStream: (options: Record<string, unknown>) => {
      capturedOptions = options;
      return {
        isLoading: false,
        messages: [],
        stop: rs.fn(),
        submit: rs.fn(),
        values: { title: "", messages: [] },
      };
    },
  }));
  rs.doMock("@/core/api", () => ({
    getAPIClient: () => ({}),
  }));
  rs.doMock("@/core/i18n/hooks", () => ({
    useI18n: () => ({
      t: {
        pages: { newChat: "New chat" },
        uploads: { uploadingFiles: "Uploading files" },
        conversation: {
          runRecoveryRequired:
            "The previous run stopped after a server interruption. Send the request again to continue.",
        },
      },
    }),
  }));
  rs.doMock("sonner", () => ({
    toast: Object.assign(rs.fn(), {
      error: rs.fn(),
      warning: warningToast,
    }),
  }));
  rs.doMock("@/core/tasks/context", () => ({
    useSubtaskContext: () => ({
      tasksRef: { current: {} },
      setTasks: rs.fn(),
    }),
    useUpdateSubtask: () => rs.fn(),
  }));

  const { useThreadStream } = await import("@/core/threads/hooks");
  function ThreadStreamCapture() {
    useThreadStream({
      context: {
        mode: "flash",
      },
      isMock: true,
    } as never);
    return null;
  }
  ThreadStreamCapture();

  return capturedOptions;
}

afterEach(() => {
  rs.doUnmock("react");
  rs.doUnmock("@tanstack/react-query");
  rs.doUnmock("@langchain/langgraph-sdk/react");
  rs.doUnmock("@/core/api");
  rs.doUnmock("@/core/i18n/hooks");
  rs.doUnmock("@/core/tasks/context");
  rs.doUnmock("sonner");
  warningToast.mockReset();
  rs.resetModules();
});

test("does not subscribe to unsupported LangGraph events mode", async () => {
  const options = await captureThreadStreamOptions();

  expect(options).toBeDefined();
  expect(options).not.toHaveProperty("onLangChainEvent");
  expect(options).toHaveProperty("onUpdateEvent");
  expect(options).toHaveProperty("onCustomEvent");
});

test("warns when the backend requires a new run after orphan recovery", async () => {
  const options = await captureThreadStreamOptions();

  const onCustomEvent = options?.onCustomEvent as
    | ((event: unknown) => void)
    | undefined;
  expect(onCustomEvent).toBeDefined();
  onCustomEvent?.({
    type: "run_recovery_required",
    code: "orphan_recovered",
    run_id: "run-1",
    recovery: "start_new_run",
  });

  expect(warningToast).toHaveBeenCalledWith(
    "The previous run stopped after a server interruption. Send the request again to continue.",
  );
});
