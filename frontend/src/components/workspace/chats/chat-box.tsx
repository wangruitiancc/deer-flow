import { FilesIcon, MicIcon, XIcon } from "lucide-react";
import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  type Layout,
  type PanelSize,
  usePanelRef,
} from "react-resizable-panels";

import { ConversationEmptyState } from "@/components/ai-elements/conversation";
import { Button } from "@/components/ui/button";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { workspaceAttachments } from "@/core/law/workspace-attachments";
import { env } from "@/env";
import { useRightPanelOverlay } from "@/hooks/use-right-panel-overlay";
import { cn } from "@/lib/utils";

import { useArtifacts } from "../artifacts/context";
import { useMaybeBrowserView } from "../browser-view/context";
import type { SpeechWorkspaceActivity } from "../law/matter-speech-panel";
import { useThread } from "../messages/context";
import { useMaybeSidecar } from "../sidecar/context";

function RightPanelLoading() {
  return (
    <div className="grid size-full place-items-center">
      <p role="status" className="text-muted-foreground text-sm">
        正在加载工作区…
      </p>
    </div>
  );
}

const ArtifactFileDetail = dynamic(
  () =>
    import("../artifacts/artifact-file-detail").then(
      (module) => module.ArtifactFileDetail,
    ),
  { loading: RightPanelLoading },
);
const ArtifactFileList = dynamic(
  () =>
    import("../artifacts/artifact-file-list").then(
      (module) => module.ArtifactFileList,
    ),
  { loading: RightPanelLoading },
);
const BrowserViewPanel = dynamic(
  () =>
    import("../browser-view/browser-view-panel").then(
      (module) => module.BrowserViewPanel,
    ),
  { loading: RightPanelLoading },
);
const SidecarPanel = dynamic(
  () =>
    import("../sidecar/sidecar-panel").then((module) => module.SidecarPanel),
  { loading: RightPanelLoading },
);

const ProjectArtifactsPanel = dynamic(
  () =>
    import("../law/project-artifacts-panel").then(
      (module) => module.ProjectArtifactsPanel,
    ),
  { loading: RightPanelLoading },
);

const RIGHT_PANEL_ANIMATION_MS = 280;
const RIGHT_PANEL_DEFAULT_SIZE = "70%";

type RightPanelKind = "sidecar" | "artifacts" | "browser";

function MountedSidePanel(props: React.ComponentProps<typeof ResizablePanel>) {
  // The library treats changes to defaultSize as layout changes. Capture it once per
  // desktop mount, including a return from the tablet sheet while already open.
  const [initialSize] = useState(props.defaultSize);
  return <ResizablePanel {...props} defaultSize={initialSize} />;
}

const ChatBox: React.FC<{
  children: React.ReactNode;
  threadId: string;
  browserEnabled?: boolean;
}> = ({ children, threadId, browserEnabled = true }) => {
  const { thread, isMock } = useThread();
  const [workspaceExpanded, setWorkspaceExpanded] = useState(false);
  const [speechActivity, setSpeechActivity] =
    useState<SpeechWorkspaceActivity | null>(null);
  const [lawWorkspaceMounted, setLawWorkspaceMounted] = useState(false);
  const attachments = useMemo(
    () => workspaceAttachments(thread.values.messages ?? []),
    [thread.values.messages],
  );
  const useOverlay = useRightPanelOverlay();
  const pathname = usePathname();
  const threadIdRef = useRef(threadId);

  const {
    artifacts,
    open: artifactsOpen,
    setOpen: setArtifactsOpen,
    setArtifacts,
    select: selectArtifact,
    deselect,
    selectedArtifact,
  } = useArtifacts();
  const sidecar = useMaybeSidecar();
  const sidecarOpen = sidecar?.open ?? false;
  const browserView = useMaybeBrowserView();
  const browserViewOpen = browserEnabled && (browserView?.open ?? false);

  const [autoSelectFirstArtifact, setAutoSelectFirstArtifact] = useState(true);
  useEffect(() => {
    const threadArtifacts = Array.isArray(thread.values.artifacts)
      ? thread.values.artifacts
      : undefined;

    if (threadIdRef.current !== threadId) {
      threadIdRef.current = threadId;
      deselect();
    }

    // Update artifacts from the current thread
    // An empty initial state must not erase artifacts restored by the provider
    // before the persisted thread state has arrived.
    if (threadArtifacts && threadArtifacts.length > 0) {
      setArtifacts(threadArtifacts);
    }

    // DO NOT automatically deselect the artifact when switching threads, because the artifacts auto discovering is not work now.
    // if (
    //   selectedArtifact &&
    //   !thread.values.artifacts?.includes(selectedArtifact)
    // ) {
    //   deselect();
    // }

    if (
      env.NEXT_PUBLIC_STATIC_WEBSITE_ONLY === "true" &&
      autoSelectFirstArtifact
    ) {
      if (threadArtifacts && threadArtifacts.length > 0) {
        setAutoSelectFirstArtifact(false);
        selectArtifact(threadArtifacts[0]!);
      }
    }
  }, [
    threadId,
    autoSelectFirstArtifact,
    deselect,
    selectArtifact,
    selectedArtifact,
    setArtifacts,
    thread.values.artifacts,
  ]);

  const artifactPanelOpen = useMemo(() => {
    if (sidecarOpen) {
      return false;
    }
    if (env.NEXT_PUBLIC_STATIC_WEBSITE_ONLY === "true") {
      return artifactsOpen && artifacts?.length > 0;
    }
    return artifactsOpen;
  }, [artifactsOpen, artifacts, sidecarOpen]);

  const activeRightPanel: RightPanelKind | null = sidecarOpen
    ? "sidecar"
    : browserViewOpen
      ? "browser"
      : artifactPanelOpen
        ? "artifacts"
        : null;
  const rightPanelOpen = activeRightPanel !== null;
  const modalPanel = rightPanelOpen && (workspaceExpanded || useOverlay);
  const workspaceRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!modalPanel) return;
    const previous = document.activeElement;
    workspaceRef.current?.querySelector<HTMLElement>("button")?.focus();
    return () => {
      if (previous instanceof HTMLElement && previous.isConnected)
        previous.focus({ preventScroll: true });
    };
  }, [modalPanel]);
  const [renderedRightPanel, setRenderedRightPanel] =
    useState<RightPanelKind | null>(activeRightPanel);

  const resizableIdBase = useMemo(() => {
    return pathname.replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
  }, [pathname]);

  const sidePanelRef = usePanelRef();
  // Width the panel reopens at: the last size the user dragged it to.
  const openSizeRef = useRef(RIGHT_PANEL_DEFAULT_SIZE);
  const [layoutReady, setLayoutReady] = useState(false);
  useEffect(() => {
    try {
      const size = Number(
        window.localStorage.getItem("matrix-law:right-panel-width:v1"),
      );
      if (size >= 15 && size <= 85) {
        openSizeRef.current = `${size}%`;
      }
    } catch {
      /* Optional width preference. */
    }
    setLayoutReady(true);
  }, []);
  // While the panel width animates, the content is held at its final width and
  // clipped instead of reflowing every frame — a reflowing message list keeps
  // re-running its scroll-to-bottom (pinned by the sidecar scroll regression
  // test), and re-wrapping text mid-animation looks unsettled. Expressed in
  // `cqw` against the group so it tracks the final width even if the group
  // itself resizes during the animation.
  const [pinnedContentWidth, setPinnedContentWidth] = useState<string | null>(
    null,
  );
  // Size transitions belong to open/close only: leaving them on during a drag
  // would interpolate every pointer frame and make the handle feel laggy.
  const [animatingRightPanel, setAnimatingRightPanel] = useState(false);
  const rightPanelOpenRef = useRef(rightPanelOpen);
  const previousOverlayRef = useRef(useOverlay);

  const handleSidePanelResize = useCallback((size: PanelSize) => {
    if (!rightPanelOpenRef.current || size.asPercentage <= 0) {
      return;
    }
    openSizeRef.current = `${size.asPercentage}%`;
    try {
      window.localStorage.setItem(
        "matrix-law:right-panel-width:v1",
        String(size.asPercentage),
      );
    } catch {
      /* Layout remains usable. */
    }
  }, []);

  const handlePanelGroupLayoutChanged = useCallback(
    (layout: Layout) => {
      if (
        !rightPanelOpenRef.current ||
        layout[`${resizableIdBase}-side`] !== 0
      ) {
        return;
      }

      // Finalize a drag-collapse only after the pointer is released. Closing
      // from onResize at the first 0% frame would break a continuous gesture
      // that reaches the edge and then reverses before release.
      if (activeRightPanel === "sidecar") {
        sidecar?.close();
      } else if (activeRightPanel === "browser") {
        browserView?.close();
      } else if (activeRightPanel === "artifacts") {
        setArtifactsOpen(false);
      }
    },
    [activeRightPanel, browserView, resizableIdBase, setArtifactsOpen, sidecar],
  );

  useEffect(() => {
    if (!layoutReady) return;
    const remountedDesktop = previousOverlayRef.current && !useOverlay;
    previousOverlayRef.current = useOverlay;
    if (rightPanelOpenRef.current === rightPanelOpen && !remountedDesktop) {
      return;
    }
    rightPanelOpenRef.current = rightPanelOpen;

    setAnimatingRightPanel(true);
    if (!rightPanelOpen) {
      // Remember the width now: the closing animation reports shrinking sizes,
      // so sampling those would reopen the panel a few pixels wide.
      const size = sidePanelRef.current?.getSize().asPercentage ?? 0;
      if (size > 0) {
        openSizeRef.current = `${size}%`;
      }
    }

    const openPercentage = Number.parseFloat(openSizeRef.current);
    setPinnedContentWidth(
      Number.isFinite(openPercentage) ? `${openPercentage}cqw` : null,
    );

    // resize() rather than expand(): the library expands to `minSize` until it
    // has recorded a size of its own, which would reopen narrower than before.
    if (rightPanelOpen) {
      sidePanelRef.current?.resize(openSizeRef.current);
    } else {
      sidePanelRef.current?.collapse();
    }

    const timeout = window.setTimeout(() => {
      setAnimatingRightPanel(false);
      setPinnedContentWidth(null);
    }, RIGHT_PANEL_ANIMATION_MS);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [rightPanelOpen, sidePanelRef, useOverlay, layoutReady]);

  useEffect(() => {
    if (activeRightPanel) {
      setRenderedRightPanel(activeRightPanel);
      return;
    }

    const timeout = window.setTimeout(() => {
      setWorkspaceExpanded(false);
    }, RIGHT_PANEL_ANIMATION_MS);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [activeRightPanel]);

  useEffect(() => {
    if (sidecarOpen && artifactsOpen) {
      setArtifactsOpen(false);
    }
  }, [artifactsOpen, setArtifactsOpen, sidecarOpen]);

  useEffect(() => {
    if (!browserEnabled && browserView?.open) {
      browserView.close();
    }
  }, [browserEnabled, browserView]);

  const nativeRightPanelContent = useMemo(() => {
    if (renderedRightPanel === "browser") {
      return <BrowserViewPanel threadId={threadId} className="size-full" />;
    }
    if (renderedRightPanel === "sidecar") {
      return <SidecarPanel />;
    }
    if (renderedRightPanel === "artifacts" && selectedArtifact) {
      return (
        <ArtifactFileDetail
          className="size-full"
          filepath={selectedArtifact}
          threadId={threadId}
        />
      );
    }
    if (renderedRightPanel === "artifacts") {
      return (
        <div className="relative flex size-full justify-center">
          <div className="absolute top-1 right-1 z-30">
            <Button
              size="icon-sm"
              variant="ghost"
              onClick={() => {
                setArtifactsOpen(false);
              }}
            >
              <XIcon />
            </Button>
          </div>
          {artifacts.length === 0 ? (
            <ConversationEmptyState
              icon={<FilesIcon />}
              title="尚未选择文件"
              description="从本会话文件或项目成果中选择一项查看详情"
            />
          ) : (
            <div className="flex size-full max-w-(--container-width-sm) flex-col justify-center p-4 pt-8">
              <header className="shrink-0">
                <h2 className="text-lg font-medium">本会话文件</h2>
              </header>
              <main className="min-h-0 grow">
                <ArtifactFileList
                  className="max-w-(--container-width-sm) p-4 pt-12"
                  files={artifacts}
                  threadId={threadId}
                />
              </main>
            </div>
          )}
        </div>
      );
    }
    return null;
  }, [
    renderedRightPanel,
    selectedArtifact,
    threadId,
    artifacts,
    setArtifactsOpen,
  ]);

  useEffect(() => {
    if (renderedRightPanel === "artifacts") setLawWorkspaceMounted(true);
  }, [renderedRightPanel]);
  const legalWorkspace =
    !isMock && env.NEXT_PUBLIC_STATIC_WEBSITE_ONLY !== "true";
  const rightPanelContent = legalWorkspace ? (
    <>
      {(lawWorkspaceMounted || renderedRightPanel === "artifacts") && (
        <div
          hidden={renderedRightPanel !== "artifacts"}
          className="size-full min-h-0"
        >
          <ProjectArtifactsPanel
            key={threadId}
            threadId={threadId}
            expanded={workspaceExpanded}
            onExpandedChange={setWorkspaceExpanded}
            attachments={attachments}
            onSpeechActivityChange={setSpeechActivity}
          />
        </div>
      )}
      {renderedRightPanel !== "artifacts" && nativeRightPanelContent}
    </>
  ) : (
    nativeRightPanelContent
  );

  if (!layoutReady) return <RightPanelLoading />;

  return (
    <ResizablePanelGroup
      id={`${resizableIdBase}-group`}
      orientation="horizontal"
      onLayoutChanged={handlePanelGroupLayoutChanged}
      className={cn(
        "size-full min-h-0",
        modalPanel ? "[container-type:normal]" : "[container-type:inline-size]",
        // The sized flex item is the library's own `[data-panel]` element, not
        // the child `className` lands on, so the open/close transition has to be
        // addressed from here.
        animatingRightPanel &&
          "[&>[data-panel]]:transition-[flex-grow] [&>[data-panel]]:duration-[280ms] [&>[data-panel]]:ease-out motion-reduce:[&>[data-panel]]:transition-none",
      )}
    >
      <ResizablePanel
        id={`${resizableIdBase}-chat`}
        minSize="15%"
        className="relative min-h-0 min-w-0"
      >
        <div
          inert={modalPanel}
          className="relative flex size-full min-h-0 min-w-0 flex-col"
          id="chat"
        >
          {speechActivity && activeRightPanel !== "artifacts" && (
            <div className="law-capture-return" role="status">
              <MicIcon />
              <button
                onClick={() => {
                  sidecar?.close();
                  browserView?.close();
                  speechActivity.returnToCapture?.();
                  setArtifactsOpen(true);
                }}
              >
                返回录音 · {speechActivity.seconds} 秒 · {speechActivity.label}
              </button>
              {speechActivity.recording && (
                <button
                  className="ml-auto shrink-0 rounded border px-2 py-1"
                  onClick={speechActivity.stop}
                >
                  停止并保存
                </button>
              )}
            </div>
          )}
          <div className="relative min-h-0 flex-1">{children}</div>
        </div>
      </ResizablePanel>
      <ResizableHandle
        id={`${resizableIdBase}-separator`}
        withHandle
        aria-label="调整中间与右侧工作区宽度"
        disabled={!rightPanelOpen || useOverlay}
        className={cn(
          "opacity-33 transition-opacity duration-200 ease-out hover:opacity-100 motion-reduce:transition-none",
          !rightPanelOpen && "pointer-events-none opacity-0",
        )}
      />
      <MountedSidePanel
        id={`${resizableIdBase}-side`}
        panelRef={sidePanelRef}
        collapsible
        collapsedSize="0%"
        defaultSize={rightPanelOpen ? openSizeRef.current : "0%"}
        minSize="15%"
        onResize={handleSidePanelResize}
        className="min-h-0 min-w-0"
      >
        <aside
          ref={workspaceRef}
          inert={!rightPanelOpen}
          role={modalPanel ? "dialog" : undefined}
          aria-modal={modalPanel ? true : undefined}
          aria-label="法律工作区"
          aria-hidden={!rightPanelOpen}
          onKeyDown={(event) => {
            if (event.key === "Escape" && modalPanel) {
              event.preventDefault();
              if (workspaceExpanded && !useOverlay) setWorkspaceExpanded(false);
              else setArtifactsOpen(false);
              return;
            }
            if (event.key === "Tab" && modalPanel) {
              const controls = [
                ...(workspaceRef.current?.querySelectorAll<HTMLElement>(
                  'button:not([disabled]), a[href], input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex="0"], [contenteditable="true"]',
                ) ?? []),
              ].filter((element) => element.getClientRects().length > 0);
              const first = controls[0];
              const last = controls.at(-1);
              if (event.shiftKey && document.activeElement === first) {
                event.preventDefault();
                last?.focus();
              } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first?.focus();
              }
            }
          }}
          className={cn(
            "size-full min-h-0 min-w-0 overflow-hidden transition-opacity duration-[280ms] ease-out motion-reduce:transition-none",
            rightPanelOpen ? "opacity-100" : "pointer-events-none opacity-0",
            modalPanel && "bg-background fixed inset-0 z-40",
          )}
          id="artifacts"
        >
          <div
            className="ml-auto h-full"
            style={
              modalPanel || pinnedContentWidth === null
                ? undefined
                : { width: pinnedContentWidth }
            }
          >
            {rightPanelContent}
          </div>
        </aside>
      </MountedSidePanel>
    </ResizablePanelGroup>
  );
};

export { ChatBox };
