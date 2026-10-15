"use client";

import { useCallback, useLayoutEffect, useRef, useState } from "react";

import type { SpeechCapturePreviewWindow } from "@/core/law/types";

export function SpeechCapturePreview({
  windows,
}: {
  windows: readonly SpeechCapturePreviewWindow[];
}) {
  const root = useRef<HTMLElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const followsLatest = useRef(true);
  const revealed = useRef(false);
  const [following, setFollowing] = useState(true);

  const follow = useCallback(() => {
    const element = list.current;
    if (!element || !followsLatest.current) return;
    element.scrollTop = Math.max(
      0,
      element.scrollHeight - element.clientHeight,
    );
    const section = root.current;
    if (
      !revealed.current &&
      section &&
      !section.closest('[hidden], [inert], [aria-hidden="true"]') &&
      Array.from(section.getClientRects()).some(
        (rect) => rect.width > 0 && rect.height > 0,
      )
    ) {
      section.scrollIntoView?.({ block: "nearest", inline: "nearest" });
      revealed.current = true;
    }
  }, []);

  useLayoutEffect(follow, [windows, follow]);
  useLayoutEffect(() => {
    if (!list.current || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(follow);
    observer.observe(list.current);
    return () => observer.disconnect();
  }, [follow]);

  return (
    <section
      ref={root}
      className="law-speech-preview"
      aria-label="录音临时识别预览"
    >
      <header>
        <p title="机器预览 · 未审核，不可引用">机器预览 · 未审核，不可引用</p>
        {!following && (
          <button
            type="button"
            onClick={() => {
              followsLatest.current = true;
              setFollowing(true);
              follow();
            }}
          >
            回到最新
          </button>
        )}
      </header>
      <div
        ref={list}
        className="law-speech-preview-list"
        role="log"
        aria-label="录音预览内容"
        tabIndex={0}
        onScroll={(event) => {
          const element = event.currentTarget;
          const nearBottom =
            element.scrollHeight - element.clientHeight - element.scrollTop <=
            24;
          followsLatest.current = nearBottom;
          setFollowing(nearBottom);
        }}
      >
        {windows.map((window) => (
          <div key={window.window_id}>
            <span data-speech-preview-time={window.transcript ? "" : undefined}>
              {Math.floor(window.start_sample / 16_000)}–
              {Math.floor(window.end_sample / 16_000)} 秒
            </span>
            {(window.transcript?.text.length
              ? window.transcript.text
              : undefined) ??
              (window.transcript
                ? "本窗口未识别到文字。"
                : "本窗口暂未产生识别预览。")}
          </div>
        ))}
      </div>
    </section>
  );
}
