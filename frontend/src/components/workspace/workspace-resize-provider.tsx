"use client";

import { GripVerticalIcon } from "lucide-react";
import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";

import { SidebarProvider, useSidebar } from "@/components/ui/sidebar";

const WIDTH_KEY = "matrix-law:sidebar-width:v1";
const DEFAULT_WIDTH = 256;
export function clampSidebarWidth(width: number, viewportWidth: number) {
  return Math.min(
    Math.max(160, width),
    Math.max(160, Math.min(640, viewportWidth * 0.45)),
  );
}

export function WorkspaceResizeProvider({
  children,
  defaultOpen,
}: {
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  const [ready, setReady] = useState(false);
  const [viewportWidth, setViewportWidth] = useState(1440);
  useEffect(() => {
    try {
      const saved = Number(window.localStorage.getItem(WIDTH_KEY));
      if (saved >= 160 && Number.isFinite(saved))
        setWidth(clampSidebarWidth(saved, 1440));
    } catch {
      /* Layout works with browser storage disabled. */
    }
    setViewportWidth(window.innerWidth);
    setReady(true);
    // Clamp the rendered width without overwriting the preferred desktop size.
    const resized = () => setViewportWidth(window.innerWidth);
    window.addEventListener("resize", resized);
    return () => window.removeEventListener("resize", resized);
  }, []);
  useEffect(() => {
    if (!ready) return;
    try {
      window.localStorage.setItem(WIDTH_KEY, String(width));
    } catch {
      /* Optional UI preference only. */
    }
  }, [width, ready]);
  const renderedWidth = clampSidebarWidth(width, Math.max(768, viewportWidth));
  return (
    <SidebarProvider
      defaultOpen={defaultOpen}
      className="h-screen overflow-hidden [&_[data-slot=sidebar-container]]:transition-none [&_[data-slot=sidebar-gap]]:transition-none"
      style={{ "--sidebar-width": `${renderedWidth}px` } as CSSProperties}
    >
      {children}
      <SidebarResizeHandle width={renderedWidth} onResize={setWidth} />
    </SidebarProvider>
  );
}

function SidebarResizeHandle({
  width,
  onResize,
}: {
  width: number;
  onResize: (width: number) => void;
}) {
  const { open, isMobile } = useSidebar();
  const drag = useRef<{ pointerId: number; offset: number } | null>(null);
  if (!open || isMobile) return null;
  const change = (value: number) =>
    onResize(clampSidebarWidth(value, window.innerWidth));
  return (
    <div
      role="separator"
      aria-label="调整左侧与中间工作区宽度"
      aria-orientation="vertical"
      aria-valuemin={160}
      aria-valuemax={640}
      aria-valuenow={Math.round(width)}
      tabIndex={0}
      className="hover:bg-primary/30 focus-visible:bg-primary/30 fixed inset-y-0 z-30 hidden w-2 -translate-x-1/2 cursor-col-resize touch-none items-center justify-center outline-none md:flex"
      style={{ left: width }}
      onDoubleClick={() => change(DEFAULT_WIDTH)}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        drag.current = {
          pointerId: event.pointerId,
          offset: event.clientX - width,
        };
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        if (drag.current?.pointerId === event.pointerId)
          change(event.clientX - drag.current.offset);
      }}
      onPointerUp={(event) => {
        if (drag.current?.pointerId === event.pointerId) {
          drag.current = null;
          event.currentTarget.releasePointerCapture(event.pointerId);
        }
      }}
      onPointerCancel={() => {
        drag.current = null;
      }}
      onLostPointerCapture={() => {
        drag.current = null;
      }}
      onKeyDown={(event) => {
        if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
          event.preventDefault();
          change(
            event.key === "Home"
              ? 160
              : event.key === "End"
                ? 640
                : width +
                  (event.key === "ArrowRight" ? 1 : -1) *
                    (event.shiftKey ? 40 : 10),
          );
        }
      }}
    >
      <span className="bg-border flex h-5 w-2 items-center rounded">
        <GripVerticalIcon className="size-3" />
      </span>
    </div>
  );
}
