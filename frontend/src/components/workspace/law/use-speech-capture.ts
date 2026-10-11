"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { registerAuthSessionCleanup } from "@/core/auth/session-lifecycle";
import {
  cancelMatterSpeechCapture,
  createMatterSpeechCapture,
  finishMatterSpeechCapture,
  getMatterSpeechCapture,
  getMatterSpeechCapturePreview,
  listMatterSpeechCaptureChunks,
  listMatterSpeechCaptures,
  uploadMatterSpeechCaptureChunk,
} from "@/core/law";
import type {
  SpeechCaptureAudioTrackSettings,
  SpeechCapturePreviewWindow,
  SpeechCaptureSession,
} from "@/core/law";
import {
  LAW_MATTER_ACCESS_REVOKED_EVENT,
  type LawMatterAccessRevokedDetail,
} from "@/core/law/speech-capture-access-events";
import { validateSpeechCaptureLimits } from "@/core/law/speech-capture-limits";
import {
  acknowledgeSpeechPcmChunk,
  acquireSpeechCaptureLock,
  adoptServerSpeechCapture,
  clearLocalSpeechMatter,
  clearLocalSpeechIdentity,
  createLocalSpeechCapture,
  deleteLocalSpeechCapture,
  getLocalSpeechCapture,
  isLocalSpeechCaptureStorageUnavailable,
  LOCAL_SPEECH_CAPTURE_STORAGE_UNAVAILABLE,
  listLocalSpeechCaptures,
  localSpeechIdentityScope,
  localSpeechCapturesForMatter,
  persistSpeechPcmChunk,
  readPendingSpeechPcmChunks,
  speechCaptureStorageAvailable,
  updateLocalSpeechCapture,
  verifySpeechCaptureStorage,
  type LocalSpeechCaptureSession,
} from "@/core/law/speech-capture-outbox";
import { mergeSpeechCapturePreview } from "@/core/law/speech-capture-preview";

export type SpeechCaptureUiState =
  | "idle"
  | "starting"
  | "recording"
  | "offline_buffering"
  | "stopping"
  | "finalizing"
  | "upload_error"
  | "interrupted"
  | "revoked";

interface CaptureController {
  scope: string;
  session: LocalSpeechCaptureSession;
  releaseLock: () => void;
  stream: MediaStream;
  context: AudioContext;
  node: AudioWorkletNode;
  sequence: Promise<void>;
  chainDepth: number;
  stopped: boolean;
  cancelled: boolean;
  discardLocalOnExit: boolean;
  flushResolve?: () => void;
  endReason: "user_stop" | "interrupted" | "limit_reached";
  uploadPromise: Promise<void> | null;
  drainAgain: boolean;
  finalizing: boolean;
  storageFailureMessage: string | null;
}

function pcmArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function nextTurn(): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, 900));
}

class SpeechCaptureAudioContextUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SpeechCaptureAudioContextUnavailableError";
  }
}

async function resumeAudioContext(context: AudioContext): Promise<void> {
  let timeoutId: number | null = null;
  try {
    await Promise.race([
      context.resume(),
      new Promise<never>((_, reject) => {
        timeoutId = window.setTimeout(
          () =>
            reject(
              new SpeechCaptureAudioContextUnavailableError(
                "浏览器未能及时启动音频上下文，已关闭麦克风采集。请使用其他支持的浏览器或上传音视频文件。",
              ),
            ),
          2_000,
        );
      }),
    ]);
    if (context.state !== "running")
      throw new SpeechCaptureAudioContextUnavailableError(
        "浏览器未能启动音频上下文，已关闭麦克风采集。请使用其他支持的浏览器或上传音视频文件。",
      );
  } finally {
    if (timeoutId !== null) window.clearTimeout(timeoutId);
  }
}

async function loadSpeechCaptureWorklet(context: AudioContext): Promise<void> {
  let timeoutId: number | null = null;
  try {
    await Promise.race([
      context.audioWorklet.addModule("/worklets/pcm16-capture.js"),
      new Promise<never>((_, reject) => {
        timeoutId = window.setTimeout(
          () =>
            reject(
              new SpeechCaptureAudioContextUnavailableError(
                "浏览器未能及时启动录音处理模块，已关闭麦克风采集。请使用其他支持的浏览器或上传音视频文件。",
              ),
            ),
          3_000,
        );
      }),
    ]);
  } finally {
    if (timeoutId !== null) window.clearTimeout(timeoutId);
  }
}

function isDenied(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    [401, 403, 404].includes(Number((error as { status: unknown }).status))
  );
}

function describeCaptureStartupError(error: unknown): string {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "SPEECH_CAPTURE_CAPACITY_BUSY"
  )
    return "实时录音容量正在使用，请先保存已有录音后重试。";
  if (
    error instanceof Error &&
    (["OverconstrainedError", "NotSupportedError"].includes(error.name) ||
      /invalid constraint/i.test(error.message))
  ) {
    return "当前浏览器或麦克风不支持所需的音频录音设置；麦克风已关闭。请检查设备权限，或上传音视频文件。";
  }
  return error instanceof Error ? error.message : "无法启动案件录音。";
}

function describeStorageFailure(error: unknown): string {
  if (
    error instanceof Error &&
    /^(PCM 分片长度|PCM 尾片只能|录音达到|本机会话暂存达到|本机同源录音暂存达到)/.test(
      error.message,
    )
  ) {
    return error.message;
  }
  return "本机加密暂存写入失败，录音已停止。只保留已提交的分片，未提交的尾部无法恢复。";
}

export function useSpeechCapture({
  tenantId,
  matterId,
  userId,
  membershipId,
  available,
  onCompleted,
}: {
  tenantId: string;
  matterId: string;
  userId: string;
  membershipId: string;
  available: boolean;
  onCompleted: (session: SpeechCaptureSession) => void;
}) {
  const [state, setState] = useState<SpeechCaptureUiState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [supported, setSupported] = useState(false);
  const [serverRecoverable, setServerRecoverable] = useState<
    SpeechCaptureSession[]
  >([]);
  const [captureId, setCaptureId] = useState<string | null>(null);
  const [capturedSamples, setCapturedSamples] = useState(0);
  const [localSavedSamples, setLocalSavedSamples] = useState(0);
  const [serverConfirmedSamples, setServerConfirmedSamples] = useState(0);
  const [previewWindows, setPreviewWindows] = useState<
    SpeechCapturePreviewWindow[]
  >([]);
  const controllerRef = useRef<CaptureController | null>(null);
  const sessionRef = useRef<LocalSpeechCaptureSession | null>(null);
  const scopeRef = useRef<string | null>(null);
  const generationRef = useRef(0);
  const startLockRef = useRef(false);
  const stopCaptureRef = useRef<() => Promise<void>>(async () => undefined);
  const startupResourcesRef = useRef<{
    generation: number;
    context: AudioContext;
    stream: MediaStream | null;
    releaseLock: () => void;
  } | null>(null);
  const onCompletedRef = useRef(onCompleted);
  const activeIdentityRef = useRef({ userId, membershipId });
  const revocationStartedRef = useRef(false);

  onCompletedRef.current = onCompleted;

  useEffect(() => {
    let active = true;
    setSupported(false);
    setError(null);
    const browserSupportsCapture =
      available &&
      speechCaptureStorageAvailable() &&
      typeof AudioContext !== "undefined" &&
      "audioWorklet" in AudioContext.prototype &&
      !!navigator.locks?.request &&
      !!navigator.mediaDevices?.getUserMedia;
    if (browserSupportsCapture) {
      void verifySpeechCaptureStorage().then(
        () => {
          if (active) setSupported(true);
        },
        (error: unknown) => {
          if (!active) return;
          setSupported(false);
          if (isLocalSpeechCaptureStorageUnavailable(error))
            setError(LOCAL_SPEECH_CAPTURE_STORAGE_UNAVAILABLE);
        },
      );
    }
    return () => {
      active = false;
    };
  }, [available]);

  const completeCapture = useCallback(
    async (
      scope: string,
      local: LocalSpeechCaptureSession,
      remote: SpeechCaptureSession,
      isCurrent: () => boolean = () => true,
    ) => {
      if (!isCurrent()) return;
      await deleteLocalSpeechCapture(scope, local.localId);
      if (!isCurrent()) return;
      if (controllerRef.current?.session.localId === local.localId) {
        controllerRef.current.releaseLock();
        controllerRef.current = null;
      }
      sessionRef.current = null;
      scopeRef.current = null;
      setCaptureId(null);
      setState("idle");
      setError(null);
      if (remote.status === "completed") onCompletedRef.current(remote);
    },
    [],
  );

  const pollFinalization = useCallback(
    async (
      scope: string,
      local: LocalSpeechCaptureSession,
      isCurrent: () => boolean = () => true,
    ): Promise<SpeechCaptureSession | null> => {
      if (!isCurrent()) return null;
      if (!local.captureId) throw new Error("找不到服务器录音会话。");
      const current = local;
      await updateLocalSpeechCapture(scope, {
        ...current,
        status: "finalizing",
      });
      if (!isCurrent()) return null;
      setState("finalizing");
      for (let attempt = 0; attempt < 180; attempt += 1) {
        if (!isCurrent()) return null;
        const remote = await getMatterSpeechCapture(
          tenantId,
          matterId,
          local.captureId,
        );
        if (!isCurrent()) return null;
        if (remote.status === "completed") {
          await completeCapture(scope, current, remote, isCurrent);
          return remote;
        }
        if (["failed", "cancelled", "expired"].includes(remote.status)) {
          await updateLocalSpeechCapture(scope, {
            ...current,
            status: "interrupted",
          });
          if (!isCurrent()) return null;
          setState("upload_error");
          setError(
            `录音未完成交付（${remote.error_code ?? remote.status}）。本机暂存仍保留，可重试或取消。`,
          );
          return remote;
        }
        await nextTurn();
      }
      throw new Error("服务器仍在处理录音；本机暂存已保留，可稍后继续查看。");
    },
    [completeCapture, matterId, tenantId],
  );

  const submitFinish = useCallback(
    async (
      scope: string,
      local: LocalSpeechCaptureSession,
      endReason: "user_stop" | "interrupted" | "limit_reached",
      onFinishAccepted?: () => void,
      isCurrent: () => boolean = () => true,
    ) => {
      if (!isCurrent()) return null;
      if (!local.captureId) throw new Error("找不到服务器录音会话。");
      const remote = await getMatterSpeechCapture(
        tenantId,
        matterId,
        local.captureId,
      );
      if (!isCurrent()) return null;
      if (remote.status === "completed") {
        await completeCapture(scope, local, remote, isCurrent);
        return remote;
      }
      if (remote.status === "finalizing") {
        onFinishAccepted?.();
        return pollFinalization(scope, local, isCurrent);
      }
      if (remote.status !== "open")
        throw new Error("录音会话已关闭，不能提交保存。");
      const receipt = await finishMatterSpeechCapture(
        tenantId,
        matterId,
        local.captureId,
        local.nextSequenceNumber - 1,
        local.totalSamples,
        endReason,
      );
      if (!isCurrent()) return null;
      onFinishAccepted?.();
      const finishing = { ...local, status: "finalizing" as const, endReason };
      sessionRef.current = finishing;
      await updateLocalSpeechCapture(scope, finishing);
      if (!isCurrent()) return null;
      if (receipt.status === "completed") {
        await completeCapture(scope, finishing, receipt, isCurrent);
        return receipt;
      }
      return pollFinalization(scope, finishing, isCurrent);
    },
    [completeCapture, matterId, pollFinalization, tenantId],
  );

  const uploadPending = useCallback(
    async (
      scope: string,
      initial: LocalSpeechCaptureSession,
      reconcile: boolean,
      isCurrent: () => boolean = () => true,
    ): Promise<LocalSpeechCaptureSession> => {
      if (!isCurrent()) return initial;
      if (!initial.captureId) throw new Error("服务器尚未确认录音会话。");
      const captureId = initial.captureId;
      let local = initial;
      setState(reconcile ? "interrupted" : "recording");
      let serverNext = local.serverNextSequenceNumber;
      let confirmedSamples = Math.max(
        0,
        local.totalSamples - local.pendingBytes / 2,
      );
      if (reconcile) {
        let after = -1;
        let pageCount: number;
        const remoteReceipts = new Map<
          number,
          Awaited<
            ReturnType<typeof listMatterSpeechCaptureChunks>
          >["items"][number]
        >();
        do {
          if (!isCurrent()) return local;
          const page = await listMatterSpeechCaptureChunks(
            tenantId,
            matterId,
            captureId,
            after,
          );
          if (!isCurrent()) return local;
          pageCount = page.items.length;
          for (const receipt of page.items)
            remoteReceipts.set(receipt.sequence_number, receipt);
          if (page.items.length > 0)
            after = page.items.at(-1)?.sequence_number ?? after;
        } while (pageCount === 500);
        const remoteState = await getMatterSpeechCapture(
          tenantId,
          matterId,
          captureId,
        );
        if (!isCurrent()) return local;
        serverNext = remoteState.next_sequence_number;
        const pending = await readPendingSpeechPcmChunks(scope, local);
        if (!isCurrent()) return local;
        for (const chunk of pending) {
          if (!isCurrent()) return local;
          const remoteChunk = remoteReceipts.get(chunk.sequenceNumber);
          if (remoteChunk) {
            if (
              remoteChunk.sha256 !== chunk.sha256 ||
              remoteChunk.sample_count !== chunk.sampleCount ||
              remoteChunk.start_sample !== chunk.startSample
            ) {
              throw new Error(
                "服务器分片回执与本机加密暂存不匹配，已停止补传。",
              );
            }
            local = await acknowledgeSpeechPcmChunk(
              scope,
              local,
              chunk,
              remoteChunk.sequence_number + 1,
            );
            if (!isCurrent()) return local;
            confirmedSamples = Math.max(
              confirmedSamples,
              chunk.startSample + chunk.sampleCount,
            );
          } else if (chunk.sequenceNumber === serverNext) {
            const receipt = await uploadMatterSpeechCaptureChunk(
              tenantId,
              matterId,
              captureId,
              chunk.sequenceNumber,
              new Blob([pcmArrayBuffer(chunk.pcm)], {
                type: "application/octet-stream",
              }),
              chunk.sha256,
              {
                sampleCount: chunk.sampleCount,
                startSample: chunk.startSample,
              },
            );
            if (!isCurrent()) return local;
            if (
              receipt.capture_id !== captureId ||
              receipt.accepted_sequence_number !== chunk.sequenceNumber ||
              receipt.chunk_sha256 !== chunk.sha256 ||
              receipt.sample_count !== chunk.sampleCount ||
              receipt.start_sample !== chunk.startSample
            ) {
              throw new Error("服务器没有确认当前录音分片。");
            }
            serverNext = receipt.next_sequence_number;
            local = await acknowledgeSpeechPcmChunk(
              scope,
              local,
              chunk,
              serverNext,
            );
            if (!isCurrent()) return local;
            confirmedSamples = Math.max(
              confirmedSamples,
              chunk.startSample + chunk.sampleCount,
            );
          } else if (chunk.sequenceNumber < serverNext) {
            throw new Error("服务器确认水位缺少对应分片回执，已停止补传。");
          } else if (chunk.sequenceNumber > serverNext) {
            throw new Error("本机录音分片存在缺口，已停止补传。");
          }
        }
        const remote = await getMatterSpeechCapture(
          tenantId,
          matterId,
          captureId,
        );
        if (!isCurrent()) return local;
        serverNext = remote.next_sequence_number;
        confirmedSamples = remote.total_samples;
      } else {
        const pending = await readPendingSpeechPcmChunks(scope, local);
        if (!isCurrent()) return local;
        for (const chunk of pending) {
          if (!isCurrent()) return local;
          if (chunk.sequenceNumber < serverNext) continue;
          if (chunk.sequenceNumber !== serverNext) break;
          const receipt = await uploadMatterSpeechCaptureChunk(
            tenantId,
            matterId,
            captureId,
            chunk.sequenceNumber,
            new Blob([pcmArrayBuffer(chunk.pcm)], {
              type: "application/octet-stream",
            }),
            chunk.sha256,
            { sampleCount: chunk.sampleCount, startSample: chunk.startSample },
          );
          if (!isCurrent()) return local;
          if (
            receipt.capture_id !== captureId ||
            receipt.accepted_sequence_number !== chunk.sequenceNumber ||
            receipt.chunk_sha256 !== chunk.sha256 ||
            receipt.sample_count !== chunk.sampleCount ||
            receipt.start_sample !== chunk.startSample
          ) {
            throw new Error("服务器没有确认当前录音分片。");
          }
          serverNext = receipt.next_sequence_number;
          local = await acknowledgeSpeechPcmChunk(
            scope,
            local,
            chunk,
            serverNext,
          );
          if (!isCurrent()) return local;
          confirmedSamples = Math.max(
            confirmedSamples,
            chunk.startSample + chunk.sampleCount,
          );
        }
      }
      local = {
        ...local,
        serverNextSequenceNumber: serverNext,
        updatedAt: Date.now(),
      };
      if (!isCurrent()) return local;
      sessionRef.current = local;
      await updateLocalSpeechCapture(scope, local);
      if (!isCurrent()) return local;
      setLocalSavedSamples(local.totalSamples);
      setServerConfirmedSamples(confirmedSamples);
      return local;
    },
    [matterId, tenantId],
  );

  const reconcileSession = useCallback(
    async (
      scope: string,
      local: LocalSpeechCaptureSession,
      generation: number,
      existingRelease?: () => void,
    ): Promise<boolean> => {
      const releaseLock =
        existingRelease ?? (await acquireSpeechCaptureLock(scope, "active"));
      if (!releaseLock) return false;
      try {
        let current = local;
        if (!current.captureId) {
          const created = await createMatterSpeechCapture(tenantId, matterId, {
            title: current.title,
            media_type: "audio/wav",
            capture_protocol: "pcm_s16le_v1",
            audioTrackSettings: current.audioTrackSettings ?? null,
            idempotencyKey: current.idempotencyKey,
          });
          current = {
            ...current,
            captureId: created.id,
            status: "interrupted",
          };
          await updateLocalSpeechCapture(scope, current);
        }
        sessionRef.current = current;
        scopeRef.current = scope;
        setCaptureId(current.captureId);
        if (generation !== generationRef.current) return false;
        const remote = await getMatterSpeechCapture(
          tenantId,
          matterId,
          current.captureId!,
        );
        if (generation !== generationRef.current) return false;
        if (remote.status === "completed") {
          await completeCapture(
            scope,
            current,
            remote,
            () => generation === generationRef.current,
          );
          return true;
        }
        if (remote.status === "finalizing") {
          releaseLock();
          await pollFinalization(
            scope,
            current,
            () => generation === generationRef.current,
          );
          return true;
        }
        if (remote.status !== "open") {
          throw new Error(`录音会话已关闭（${remote.status}）。`);
        }
        current = await uploadPending(
          scope,
          current,
          true,
          () => generation === generationRef.current,
        );
        if (generation !== generationRef.current) return false;
        if (current.totalSamples === 0) {
          await cancelMatterSpeechCapture(
            tenantId,
            matterId,
            current.captureId!,
          );
          await deleteLocalSpeechCapture(scope, current.localId);
          if (sessionRef.current?.localId === current.localId)
            sessionRef.current = null;
          if (scopeRef.current === scope) scopeRef.current = null;
          setCaptureId(null);
          setCapturedSamples(0);
          setLocalSavedSamples(0);
          setServerConfirmedSamples(0);
          setState("idle");
          setError(null);
          return true;
        }
        const interrupted = {
          ...current,
          status: "finalizing" as const,
          endReason: "interrupted" as const,
        };
        await updateLocalSpeechCapture(scope, interrupted);
        await submitFinish(
          scope,
          interrupted,
          "interrupted",
          releaseLock,
          () => generation === generationRef.current,
        );
        return true;
      } finally {
        releaseLock();
      }
    },
    [
      completeCapture,
      matterId,
      pollFinalization,
      submitFinish,
      tenantId,
      uploadPending,
    ],
  );

  const handleRevokedCapture = useCallback(
    async (activeController?: CaptureController) => {
      if (revocationStartedRef.current) return;
      revocationStartedRef.current = true;
      const controller = activeController ?? controllerRef.current ?? undefined;
      const local = controller?.session ?? sessionRef.current;
      const scope = controller?.scope ?? scopeRef.current;
      generationRef.current += 1;
      setCaptureId(null);
      setPreviewWindows([]);
      setServerRecoverable([]);
      setCapturedSamples(0);
      setLocalSavedSamples(0);
      setServerConfirmedSamples(0);
      setState("revoked");
      setError("案件权限已撤销或录音会话不可用；正在停止采集并清理本机暂存。");
      const startup = startupResourcesRef.current;
      if (startup) {
        startup.stream?.getTracks().forEach((track) => track.stop());
        startup.releaseLock();
        await startup.context.close().catch(() => undefined);
        startupResourcesRef.current = null;
      }
      if (controller) {
        controller.cancelled = true;
        controller.discardLocalOnExit = true;
        controller.stopped = true;
        controller.stream.getTracks().forEach((track) => track.stop());
        controller.node.disconnect();
        await controller.context.close().catch(() => undefined);
        await controller.sequence.catch(() => undefined);
      }
      let localDataCleared = true;
      try {
        await clearLocalSpeechMatter(userId, membershipId, tenantId, matterId);
      } catch {
        localDataCleared = false;
      }
      controller?.releaseLock();
      if (!local || controllerRef.current?.session.localId === local.localId)
        controllerRef.current = null;
      if (!local || sessionRef.current?.localId === local.localId)
        sessionRef.current = null;
      if (!scope || scopeRef.current === scope) scopeRef.current = null;
      setError(
        localDataCleared
          ? "案件权限已撤销或录音会话不可用；麦克风已停止，本机暂存已清除。"
          : "案件权限已撤销；麦克风已停止，但本机暂存清理失败，请勿继续使用该页面。",
      );
    },
    [matterId, membershipId, tenantId, userId],
  );

  useEffect(() => {
    const onMatterAccessRevoked = (event: Event) => {
      const detail = (event as CustomEvent<LawMatterAccessRevokedDetail>)
        .detail;
      if (detail?.tenantId === tenantId && detail.matterId === matterId)
        void handleRevokedCapture();
    };
    window.addEventListener(
      LAW_MATTER_ACCESS_REVOKED_EVENT,
      onMatterAccessRevoked,
    );
    return () =>
      window.removeEventListener(
        LAW_MATTER_ACCESS_REVOKED_EVENT,
        onMatterAccessRevoked,
      );
  }, [handleRevokedCapture, matterId, tenantId]);

  useEffect(() => {
    const generation = ++generationRef.current;
    const controller = new AbortController();
    setServerRecoverable([]);
    void (async () => {
      if (!available || !userId || !membershipId) return;
      try {
        const local = await listLocalSpeechCaptures(userId, membershipId);
        const matching = localSpeechCapturesForMatter(
          local.sessions,
          tenantId,
          matterId,
        );
        const remote = await listMatterSpeechCaptures(
          tenantId,
          matterId,
          controller.signal,
        );
        for (const session of matching) {
          if (generation !== generationRef.current) return;
          try {
            await reconcileSession(local.scope, session, generation);
          } catch (sessionError) {
            if (isDenied(sessionError)) {
              await clearLocalSpeechMatter(
                userId,
                membershipId,
                tenantId,
                matterId,
              );
              setError("当前身份已无权恢复录音，本机加密暂存已清除。");
              return;
            }
            setState("upload_error");
            setError(
              sessionError instanceof Error
                ? sessionError.message
                : "无法恢复本机录音。",
            );
          }
        }
        if (
          generation === generationRef.current &&
          !controller.signal.aborted
        ) {
          // A fresh browser has no proof that another device stopped recording.
          // Show remote-only sessions, but never finish them just by opening a page.
          setServerRecoverable(
            remote.filter(
              (item) =>
                item.capture_protocol === "pcm_s16le_v1" &&
                !matching.some((session) => session.captureId === item.id),
            ),
          );
        }
      } catch (loadError) {
        if (!controller.signal.aborted) {
          if (isDenied(loadError)) {
            await clearLocalSpeechMatter(
              userId,
              membershipId,
              tenantId,
              matterId,
            ).catch(() => undefined);
            setError("当前身份已无权恢复录音，本机加密暂存已清除。");
            return;
          }
          if (isLocalSpeechCaptureStorageUnavailable(loadError)) {
            setSupported(false);
            setState("idle");
            setError(LOCAL_SPEECH_CAPTURE_STORAGE_UNAVAILABLE);
            return;
          }
          setState("upload_error");
          setError(
            loadError instanceof Error
              ? loadError.message
              : "无法检查待恢复录音。",
          );
        }
      }
    })();
    return () => {
      generationRef.current += 1;
      controller.abort();
      const startup = startupResourcesRef.current;
      if (startup) {
        startup.stream?.getTracks().forEach((track) => track.stop());
        void startup.context.close().catch(() => undefined);
        startup.releaseLock();
        startupResourcesRef.current = null;
        startLockRef.current = false;
      }
      const active = controllerRef.current;
      if (active) {
        active.cancelled = true;
        active.stream.getTracks().forEach((track) => track.stop());
        active.node.port.postMessage({ type: "flush" });
        void active.context.close().catch(() => undefined);
        controllerRef.current = null;
        void (async () => {
          await active.sequence.catch(() => undefined);
          await active.uploadPromise?.catch(() => undefined);
          if (!active.discardLocalOnExit) {
            await updateLocalSpeechCapture(active.scope, {
              ...active.session,
              status: "interrupted",
              endReason: "interrupted",
            }).catch(() => undefined);
          }
          active.releaseLock();
        })();
      }
    };
  }, [available, matterId, membershipId, reconcileSession, tenantId, userId]);

  useEffect(() => {
    const previous = activeIdentityRef.current;
    if (previous.userId !== userId || previous.membershipId !== membershipId) {
      void clearLocalSpeechIdentity(
        previous.userId,
        previous.membershipId,
      ).catch(() => undefined);
      activeIdentityRef.current = { userId, membershipId };
    }
  }, [membershipId, userId]);

  useEffect(
    () =>
      registerAuthSessionCleanup(async () => {
        generationRef.current += 1;
        startLockRef.current = false;
        const startup = startupResourcesRef.current;
        if (startup) {
          startup.stream?.getTracks().forEach((track) => track.stop());
          startup.releaseLock();
          await startup.context.close().catch(() => undefined);
          startupResourcesRef.current = null;
        }
        const controller = controllerRef.current;
        const captureIdToCancel =
          controller?.session.captureId ?? sessionRef.current?.captureId;
        if (controller) {
          controller.cancelled = true;
          controller.discardLocalOnExit = true;
          controller.stream.getTracks().forEach((track) => track.stop());
          controller.node.port.postMessage({ type: "flush" });
          controller.releaseLock();
          await controller.context.close().catch(() => undefined);
          await controller.sequence.catch(() => undefined);
        }
        if (captureIdToCancel) {
          void cancelMatterSpeechCapture(
            tenantId,
            matterId,
            captureIdToCancel,
          ).catch(() => undefined);
        }
        await clearLocalSpeechIdentity(userId, membershipId);
        controllerRef.current = null;
        sessionRef.current = null;
        scopeRef.current = null;
      }),
    [matterId, membershipId, tenantId, userId],
  );

  useEffect(() => {
    if (
      !captureId ||
      ![
        "recording",
        "offline_buffering",
        "stopping",
        "finalizing",
        "interrupted",
      ].includes(state)
    )
      return;
    let active = true;
    let previewState = {
      revision: 0,
      windows: [] as SpeechCapturePreviewWindow[],
    };
    const poll = async () => {
      try {
        const update = await getMatterSpeechCapturePreview(
          tenantId,
          matterId,
          captureId,
          previewState.revision,
        );
        if (!active || !update) return;
        const merged = mergeSpeechCapturePreview(previewState, update);
        if (merged === previewState) return;
        previewState = merged;
        setPreviewWindows(merged.windows);
      } catch (previewError) {
        if (isDenied(previewError)) {
          const local = sessionRef.current;
          const scope = scopeRef.current;
          if (local?.captureId === captureId && scope)
            void handleRevokedCapture(
              controllerRef.current?.session.localId === local.localId
                ? controllerRef.current
                : undefined,
            );
        }
        // Preview availability never controls whether encrypted PCM can be saved.
      }
    };
    void poll();
    const timer = window.setInterval(() => void poll(), 1000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [captureId, handleRevokedCapture, matterId, state, tenantId]);

  const drain = useCallback(
    (controller: CaptureController, reconcile = false): Promise<void> => {
      if (controller.cancelled || !controller.session.captureId)
        return Promise.resolve();
      if (controller.uploadPromise) {
        controller.drainAgain = true;
        return controller.uploadPromise;
      }
      controller.uploadPromise = (async () => {
        try {
          let doReconcile = reconcile;
          do {
            if (controllerRef.current !== controller || controller.cancelled)
              return;
            controller.drainAgain = false;
            let latest = await uploadPending(
              controller.scope,
              controller.session,
              doReconcile,
              () =>
                controllerRef.current === controller && !controller.cancelled,
            );
            if (controllerRef.current !== controller || controller.cancelled)
              return;
            const persisted = await getLocalSpeechCapture(
              controller.scope,
              latest.localId,
            );
            if (
              !persisted ||
              controllerRef.current !== controller ||
              controller.cancelled
            )
              return;
            latest = persisted;
            doReconcile = false;
            controller.session = latest;
            sessionRef.current = latest;
            setState(controller.stopped ? "stopping" : "recording");
            if (
              controller.stopped &&
              latest.pendingBytes === 0 &&
              !controller.finalizing
            ) {
              controller.finalizing = true;
              await submitFinish(
                controller.scope,
                latest,
                controller.endReason,
                controller.releaseLock,
                () =>
                  controllerRef.current === controller && !controller.cancelled,
              );
              if (controllerRef.current !== controller || controller.cancelled)
                return;
            }
          } while (controller.drainAgain && !controller.cancelled);
        } catch (uploadError) {
          if (!controller.cancelled) {
            if (isDenied(uploadError)) {
              await handleRevokedCapture(controller);
              return;
            }
            setState(navigator.onLine ? "upload_error" : "offline_buffering");
            setError(
              uploadError instanceof Error
                ? uploadError.message
                : "录音已加密保存在本机，等待重试上传。",
            );
          }
        } finally {
          const shouldDrainAgain =
            controller.drainAgain &&
            !controller.cancelled &&
            controllerRef.current === controller;
          controller.drainAgain = false;
          controller.uploadPromise = null;
          if (shouldDrainAgain) void drain(controller);
        }
      })();
      return controller.uploadPromise;
    },
    [handleRevokedCapture, submitFinish, uploadPending],
  );

  const start = useCallback(async () => {
    if (!supported || state !== "idle" || startLockRef.current) return;
    startLockRef.current = true;
    revocationStartedRef.current = false;
    const generation = ++generationRef.current;
    setState("starting");
    setError(null);
    setPreviewWindows([]);
    let stream: MediaStream | null = null;
    let context: AudioContext | null = null;
    let local: LocalSpeechCaptureSession | null = null;
    let scope: string | null = null;
    let serverCaptureId: string | null = null;
    let releaseCaptureLock: (() => void) | null = null;
    try {
      context = new AudioContext({ sampleRate: 16_000 });
      startupResourcesRef.current = {
        generation,
        context,
        stream,
        releaseLock: () => undefined,
      };
      if (context.sampleRate !== 16_000 || !context.audioWorklet)
        throw new SpeechCaptureAudioContextUnavailableError(
          "浏览器不能建立 16 kHz AudioWorklet，已关闭麦克风入口。",
        );
      const contextResume = resumeAudioContext(context);
      await contextResume;
      if (generation !== generationRef.current)
        throw new Error("录音页面已关闭，未继续启动麦克风。");
      scope = await localSpeechIdentityScope(userId, membershipId);
      if (generation !== generationRef.current)
        throw new Error("录音页面已关闭，未继续启动麦克风。");
      releaseCaptureLock = await acquireSpeechCaptureLock(scope, "active");
      if (!releaseCaptureLock)
        throw new Error(
          "另一个标签页正在录音或恢复案件录音，请在该标签页完成后重试。",
        );
      startupResourcesRef.current = {
        generation,
        context,
        stream,
        releaseLock: releaseCaptureLock,
      };
      if (generation !== generationRef.current)
        throw new Error("录音页面已关闭，未继续启动麦克风。");
      await loadSpeechCaptureWorklet(context);
      if (generation !== generationRef.current)
        throw new Error("录音页面已关闭，未继续启动麦克风。");
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      startupResourcesRef.current = {
        generation,
        context,
        stream,
        releaseLock: releaseCaptureLock,
      };
      if (generation !== generationRef.current)
        throw new Error("录音页面已关闭，麦克风已停止。");
      const browserTrackSettings =
        stream.getAudioTracks()[0]?.getSettings() ?? {};
      const audioTrackSettings: SpeechCaptureAudioTrackSettings = {
        context_sample_rate: 16_000,
        track_sample_rate: browserTrackSettings.sampleRate ?? null,
        track_channel_count: browserTrackSettings.channelCount ?? null,
        track_sample_size: browserTrackSettings.sampleSize ?? null,
        echo_cancellation: browserTrackSettings.echoCancellation ?? null,
        noise_suppression: browserTrackSettings.noiseSuppression ?? null,
        auto_gain_control: browserTrackSettings.autoGainControl ?? null,
      };
      const createdLocal = await createLocalSpeechCapture(
        userId,
        membershipId,
        {
          tenantId,
          matterId,
          title: title.trim() || "案件实时录音",
          audioTrackSettings,
        },
      );
      scope = createdLocal.scope;
      local = createdLocal.session;
      if (generation !== generationRef.current)
        throw new Error("录音页面已关闭，未继续创建录音会话。");
      sessionRef.current = local;
      scopeRef.current = scope;
      const remote = await createMatterSpeechCapture(tenantId, matterId, {
        title: local.title,
        media_type: "audio/wav",
        capture_protocol: "pcm_s16le_v1",
        audioTrackSettings,
        idempotencyKey: local.idempotencyKey,
      });
      serverCaptureId = remote.id;
      if (generation !== generationRef.current)
        throw new Error("录音页面已关闭，麦克风已停止。");
      local = {
        ...local,
        captureId: remote.id,
        limits: validateSpeechCaptureLimits(remote.limits),
        status: "recording",
      };
      await updateLocalSpeechCapture(scope, local);
      if (generation !== generationRef.current)
        throw new Error("录音页面已关闭，麦克风已停止。");
      const source = context.createMediaStreamSource(stream);
      const node = new AudioWorkletNode(context, "matrix-law-pcm16-capture", {
        numberOfInputs: 1,
        numberOfOutputs: 0,
        channelCount: 1,
        channelCountMode: "explicit",
        processorOptions: { maxSamples: local.limits!.max_samples },
      });
      const controller: CaptureController = {
        scope,
        session: local,
        releaseLock: releaseCaptureLock,
        stream,
        context,
        node,
        sequence: Promise.resolve(),
        chainDepth: 0,
        stopped: false,
        cancelled: false,
        discardLocalOnExit: false,
        endReason: "user_stop",
        uploadPromise: null,
        drainAgain: false,
        finalizing: false,
        storageFailureMessage: null,
      };
      controllerRef.current = controller;
      for (const track of stream.getTracks()) {
        track.addEventListener(
          "ended",
          () => {
            if (controllerRef.current === controller && !controller.stopped) {
              controller.endReason = "interrupted";
              setError("麦克风轨道已结束；正在保存已提交到本机的音频。");
              void stopCaptureRef.current();
            }
          },
          { once: true },
        );
      }
      startupResourcesRef.current = null;
      setCaptureId(remote.id);
      setCapturedSamples(0);
      setLocalSavedSamples(0);
      setServerConfirmedSamples(0);
      node.port.onmessage = (
        event: MessageEvent<{ type: string; samples?: ArrayBuffer }>,
      ) => {
        if (controller.cancelled) return;
        if (event.data?.type === "flushed") {
          controller.flushResolve?.();
          return;
        }
        if (controller.storageFailureMessage) return;
        if (event.data?.type === "limit_reached") {
          controller.endReason = "limit_reached";
          void stopCaptureRef.current();
          return;
        }
        if (event.data?.type !== "pcm" || !event.data.samples) return;
        controller.chainDepth += 1;
        if (
          controller.chainDepth >
          controller.session.limits!.max_uncommitted_chunks
        ) {
          controller.endReason = "limit_reached";
          void stopCaptureRef.current();
          setError(
            "采集处理队列超过服务器分片限额，录音已停止以保护本机数据。",
          );
          return;
        }
        const bytes = new Uint8Array(event.data.samples);
        const sampleCount = bytes.byteLength / 2;
        setCapturedSamples((current) => current + sampleCount);
        controller.sequence = controller.sequence
          .then(async () => {
            if (controller.cancelled || controller.storageFailureMessage)
              return;
            const persisted = await persistSpeechPcmChunk(
              controller.scope,
              controller.session,
              bytes,
            );
            controller.session = persisted.session;
            sessionRef.current = persisted.session;
            setLocalSavedSamples(persisted.session.totalSamples);
            controller.chainDepth -= 1;
            if (navigator.onLine) void drain(controller);
            else setState("offline_buffering");
            if (
              persisted.session.totalSamples >=
                controller.session.limits!.max_samples &&
              !controller.stopped
            ) {
              controller.endReason = "limit_reached";
              window.setTimeout(() => void stopCaptureRef.current(), 0);
            }
          })
          .catch((storageError: unknown) => {
            controller.chainDepth = Math.max(0, controller.chainDepth - 1);
            controller.endReason = "interrupted";
            controller.storageFailureMessage =
              describeStorageFailure(storageError);
            controller.stream.getTracks().forEach((track) => track.stop());
            window.setTimeout(() => void stopCaptureRef.current(), 0);
            setState("upload_error");
            setError(controller.storageFailureMessage);
          });
      };
      source.connect(node);
      setState("recording");
      startLockRef.current = false;
    } catch (startError) {
      stream?.getTracks().forEach((track) => track.stop());
      if (context) await context.close().catch(() => undefined);
      startupResourcesRef.current = null;
      if (serverCaptureId) {
        await cancelMatterSpeechCapture(
          tenantId,
          matterId,
          serverCaptureId,
        ).catch(() => undefined);
        if (scope && local)
          await deleteLocalSpeechCapture(scope, local.localId).catch(
            () => undefined,
          );
      }
      controllerRef.current = null;
      startLockRef.current = false;
      if (!serverCaptureId && scope && local) {
        await updateLocalSpeechCapture(scope, {
          ...local,
          status: "interrupted",
        }).catch(() => undefined);
        sessionRef.current = local;
      }
      releaseCaptureLock?.();
      if (generation !== generationRef.current) return;
      if (startError instanceof SpeechCaptureAudioContextUnavailableError)
        setSupported(false);
      if (isLocalSpeechCaptureStorageUnavailable(startError))
        setSupported(false);
      setState(serverCaptureId || !local ? "idle" : "upload_error");
      setError(
        isLocalSpeechCaptureStorageUnavailable(startError)
          ? LOCAL_SPEECH_CAPTURE_STORAGE_UNAVAILABLE
          : describeCaptureStartupError(startError),
      );
    }
  }, [
    drain,
    matterId,
    membershipId,
    state,
    supported,
    tenantId,
    title,
    userId,
  ]);

  const stop = useCallback(async () => {
    const controller = controllerRef.current;
    if (!controller || controller.stopped) return;
    controller.stopped = true;
    setState("stopping");
    controller.stream.getTracks().forEach((track) => track.stop());
    const flushed = new Promise<void>((resolve) => {
      controller.flushResolve = resolve;
      controller.node.port.postMessage({ type: "flush" });
    });
    const flushResult = await Promise.race([
      flushed.then(() => "flushed" as const),
      new Promise<"timeout">((resolve) =>
        window.setTimeout(() => resolve("timeout"), 2000),
      ),
    ]);
    if (flushResult === "timeout") {
      controller.endReason = "interrupted";
      setError(
        "录音尾部未能从采集器确认；只会保存此前已提交的音频，并标记为中断录音。",
      );
    }
    await controller.sequence;
    controller.node.disconnect();
    await controller.context.close().catch(() => undefined);
    if (controller.session.totalSamples === 0) {
      await cancelMatterSpeechCapture(
        tenantId,
        matterId,
        controller.session.captureId!,
      ).catch(() => undefined);
      await deleteLocalSpeechCapture(
        controller.scope,
        controller.session.localId,
      );
      controllerRef.current = null;
      sessionRef.current = null;
      setCaptureId(null);
      setState("idle");
      setError(
        controller.storageFailureMessage ??
          "没有已提交到本机暂存的音频样本，因此未创建案件材料。",
      );
      controller.releaseLock();
      return;
    }
    if (navigator.onLine) {
      await drain(controller);
    } else {
      const interrupted = {
        ...controller.session,
        status: "interrupted",
        endReason: controller.endReason,
      } satisfies LocalSpeechCaptureSession;
      controller.session = interrupted;
      sessionRef.current = interrupted;
      await updateLocalSpeechCapture(controller.scope, interrupted);
      controllerRef.current = null;
      setState("offline_buffering");
      setError(
        "已采集内容已加密保存到本机；联网并重新打开案件后会补传并完成保存。",
      );
      controller.releaseLock();
    }
  }, [drain, matterId, tenantId]);
  stopCaptureRef.current = stop;

  const cancel = useCallback(async () => {
    generationRef.current += 1;
    startLockRef.current = false;
    const startup = startupResourcesRef.current;
    if (startup) {
      startup.stream?.getTracks().forEach((track) => track.stop());
      await startup.context.close().catch(() => undefined);
      startupResourcesRef.current = null;
    }
    const controller = controllerRef.current;
    const local = controller?.session ?? sessionRef.current;
    const scope = controller?.scope ?? scopeRef.current;
    if (controller) {
      controller.cancelled = true;
      controller.discardLocalOnExit = true;
      controller.stream.getTracks().forEach((track) => track.stop());
      controller.node.port.postMessage({ type: "flush" });
      await controller.context.close().catch(() => undefined);
      await controller.sequence.catch(() => undefined);
    }
    controllerRef.current = null;
    if (local?.captureId)
      await cancelMatterSpeechCapture(
        tenantId,
        matterId,
        local.captureId,
      ).catch(() => undefined);
    if (scope && local) await deleteLocalSpeechCapture(scope, local.localId);
    controller?.releaseLock();
    startup?.releaseLock();
    sessionRef.current = null;
    scopeRef.current = null;
    setCaptureId(null);
    setPreviewWindows([]);
    setState("idle");
    setError(null);
  }, [matterId, tenantId]);

  const recoverServerCapture = useCallback(
    async (id: string) => {
      if (
        !supported ||
        state !== "idle" ||
        startLockRef.current ||
        !userId ||
        !membershipId
      )
        return;
      startLockRef.current = true;
      const generation = ++generationRef.current;
      let scope: string;
      let releaseLock: (() => void) | null = null;
      setError(null);
      try {
        scope = await localSpeechIdentityScope(userId, membershipId);
        if (generation !== generationRef.current) return;
        releaseLock = await acquireSpeechCaptureLock(scope, "active");
        if (!releaseLock)
          throw new Error("另一个标签页正在录音或恢复案件录音。");
        if (generation !== generationRef.current) return;
        const remote = await getMatterSpeechCapture(tenantId, matterId, id);
        if (generation !== generationRef.current) return;
        if (remote.capture_protocol !== "pcm_s16le_v1")
          throw new Error("不支持恢复此录音协议。");
        if (!["open", "finalizing", "completed"].includes(remote.status))
          throw new Error(`录音会话已关闭（${remote.status}）。`);
        const adopted = await adoptServerSpeechCapture(userId, membershipId, {
          tenantId,
          matterId,
          captureId: remote.id,
          title: remote.title,
          totalSamples: remote.total_samples,
          nextSequenceNumber: remote.next_sequence_number,
          limits: validateSpeechCaptureLimits(remote.limits),
          audioTrackSettings: remote.audio_track_settings ?? null,
        });
        if (generation !== generationRef.current) {
          await deleteLocalSpeechCapture(
            adopted.scope,
            adopted.session.localId,
          );
          return;
        }
        setServerRecoverable((items) => items.filter((item) => item.id !== id));
        await reconcileSession(
          adopted.scope,
          adopted.session,
          generation,
          releaseLock,
        );
      } catch (recoveryError) {
        if (generation === generationRef.current) {
          if (isDenied(recoveryError)) {
            await handleRevokedCapture();
            return;
          }
          setState("upload_error");
          setError(
            recoveryError instanceof Error
              ? recoveryError.message
              : "无法保存服务器录音。",
          );
        }
      } finally {
        releaseLock?.();
        startLockRef.current = false;
      }
    },
    [
      supported,
      state,
      userId,
      membershipId,
      tenantId,
      matterId,
      reconcileSession,
      handleRevokedCapture,
    ],
  );

  const retry = useCallback(async () => {
    if (!supported) return;
    setError(null);
    const controller = controllerRef.current;
    if (controller) {
      await drain(controller, true);
      return;
    }
    const local = sessionRef.current;
    const scope = scopeRef.current;
    if (!local || !scope) {
      setState("idle");
      return;
    }
    try {
      await reconcileSession(scope, local, generationRef.current);
    } catch (retryError) {
      setState("upload_error");
      setError(
        retryError instanceof Error ? retryError.message : "无法恢复录音上传。",
      );
    }
  }, [drain, reconcileSession, supported]);

  useEffect(() => {
    const online = () => {
      const controller = controllerRef.current;
      if (controller) void drain(controller, true);
      else void retry();
    };
    window.addEventListener("online", online);
    return () => window.removeEventListener("online", online);
  }, [drain, retry]);

  return {
    state,
    error,
    title,
    setTitle,
    supported,
    captureActive: Boolean(
      controllerRef.current && !controllerRef.current.stopped,
    ),
    captureId,
    serverRecoverable,
    recoverServerCapture,
    capturedSamples,
    localSavedSamples,
    serverConfirmedSamples,
    recognizedSamples: previewWindows.reduce(
      (latest, item) => Math.max(latest, item.end_sample),
      0,
    ),
    previewWindows,
    start,
    stop,
    cancel,
    retry,
  };
}
