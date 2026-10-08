"use client";

import {
  AudioLinesIcon,
  LoaderCircleIcon,
  MicIcon,
  RefreshCwIcon,
  UploadIcon,
  XCircleIcon,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import {
  cancelMatterSpeechCapture,
  createMatterSpeechCapture,
  finishMatterSpeechCapture,
  fetchEvidenceContent,
  getMatterSpeechCapture,
  uploadMatterSpeechCaptureChunk,
  useCancelLawSpeechTranscription,
  useCreateLawSpeechTranscription,
  useLawEvidence,
  useLawEvidenceVersions,
  useLawSpeechTranscription,
  useLawSpeechTranscriptions,
  useReviewLawSpeechTranscription,
  useUploadLawEvidence,
  type EvidenceVersion,
  type MatterMemberRole,
  type SpeechTranscriptSegment,
  type SpeechTranscriptSpeaker,
} from "@/core/law";

type EditableSegment = SpeechTranscriptSegment & { separatorBefore: string };

type CaptureChunk = { blob: Blob; sequenceNumber: number | null };
type CaptureUiState =
  | "idle"
  | "recording"
  | "paused"
  | "upload_error"
  | "stopping"
  | "finalizing";

type LiveCaptureController = {
  id: string;
  stream: MediaStream;
  recorder: MediaRecorder;
  maxChunkBytes: number;
  maxTotalBytes: number;
  nextSequenceNumber: number;
  queue: CaptureChunk[];
  queueBytes: number;
  capturedBytes: number;
  uploading: boolean;
  stopped: boolean;
  cancelled: boolean;
  finalizing: boolean;
  overflowed: boolean;
};

const REVIEW_ROLES: MatterMemberRole[] = ["owner", "lead", "lawyer"];
const STATUS_LABEL: Record<string, string> = {
  queued: "排队中",
  processing: "转写中",
  awaiting_review: "待律师校对",
  reviewed: "律师已校对",
  failed: "处理失败",
  cancelled: "已取消",
};

function isMediaVersion(version: EvidenceVersion, accepted: string[]): boolean {
  return (
    accepted.includes(version.media_type) && version.scan_status === "clean"
  );
}

export function MatterSpeechPanel({
  tenantId,
  matterId,
  matterRole,
}: {
  tenantId: string;
  matterId: string;
  matterRole: MatterMemberRole;
}) {
  const canReview = REVIEW_ROLES.includes(matterRole);
  const evidence = useLawEvidence(tenantId, matterId);
  const transcriptions = useLawSpeechTranscriptions(tenantId, matterId);
  const upload = useUploadLawEvidence(tenantId, matterId);
  const createTask = useCreateLawSpeechTranscription(tenantId, matterId);
  const cancelTask = useCancelLawSpeechTranscription(tenantId, matterId);
  const reviewTask = useReviewLawSpeechTranscription(tenantId, matterId);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(
    null,
  );
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [mediaUrl, setMediaUrl] = useState<string | null>(null);
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [draftSegments, setDraftSegments] = useState<EditableSegment[]>([]);
  const [draftSpeakers, setDraftSpeakers] = useState<SpeechTranscriptSpeaker[]>(
    [],
  );
  const [trailingText, setTrailingText] = useState("");
  const [captureState, setCaptureState] = useState<CaptureUiState>("idle");
  const [captureError, setCaptureError] = useState<string | null>(null);
  const [captureTitle, setCaptureTitle] = useState("");
  const [capturePendingBytes, setCapturePendingBytes] = useState(0);
  const [captureSupportedType, setCaptureSupportedType] = useState<
    string | null
  >(null);
  const mediaRef = useRef<HTMLMediaElement | null>(null);
  const captureRef = useRef<LiveCaptureController | null>(null);
  const acceptedTypes = transcriptions.data?.supported_media_types ?? [];
  const available = transcriptions.data?.transcription_available ?? false;
  const liveCaptureAvailable =
    transcriptions.data?.live_capture_available ?? false;
  const liveCaptureTypes = useMemo(
    () => transcriptions.data?.live_capture_media_types ?? [],
    [transcriptions.data?.live_capture_media_types],
  );
  const versions = useLawEvidenceVersions(tenantId, matterId, selectedItemId);
  const selectedVersion = versions.data?.find(
    (version) => version.id === selectedVersionId,
  );
  const detail = useLawSpeechTranscription(tenantId, matterId, selectedTaskId);
  const task = detail.data?.task;
  const latestVersion = detail.data?.versions.at(-1);
  const latestTranscript = latestVersion?.transcript;
  const latestVersionId = latestVersion?.id;
  const taskEvidenceItemId = task?.evidence_item_id;
  const taskEvidenceVersionId = task?.evidence_version_id;
  const tasks = useMemo(
    () => transcriptions.data?.items ?? [],
    [transcriptions.data?.items],
  );
  const selectableEvidence = useMemo(
    () => evidence.data?.filter((item) => item.status === "active") ?? [],
    [evidence.data],
  );

  useEffect(() => {
    if (
      !liveCaptureAvailable ||
      typeof window === "undefined" ||
      !navigator.mediaDevices?.getUserMedia ||
      typeof window.MediaRecorder === "undefined"
    ) {
      setCaptureSupportedType(null);
      return;
    }
    const preferred = ["audio/webm", "audio/mp4", "audio/ogg", "audio/wav"];
    setCaptureSupportedType(
      preferred.find(
        (mediaType) =>
          liveCaptureTypes.includes(mediaType) &&
          window.MediaRecorder.isTypeSupported(mediaType),
      ) ?? null,
    );
  }, [liveCaptureAvailable, liveCaptureTypes]);

  const stopCaptureTracks = (controller: LiveCaptureController) => {
    controller.stream.getTracks().forEach((track) => track.stop());
  };

  const cancelCapture = async (controller = captureRef.current) => {
    if (!controller) return;
    controller.cancelled = true;
    controller.queue.length = 0;
    controller.queueBytes = 0;
    setCapturePendingBytes(0);
    if (controller.recorder.state !== "inactive") {
      controller.recorder.stop();
    }
    stopCaptureTracks(controller);
    captureRef.current = null;
    setCaptureState("idle");
    try {
      await cancelMatterSpeechCapture(tenantId, matterId, controller.id);
    } catch (error) {
      setCaptureError(
        error instanceof Error
          ? `录音已在本机停止；服务器清理将在会话到期时重试。${error.message}`
          : "录音已在本机停止；服务器清理将在会话到期时重试。",
      );
    }
  };

  const finalizeCapture = async (controller: LiveCaptureController) => {
    if (
      controller.finalizing ||
      controller.cancelled ||
      controller.overflowed
    ) {
      return;
    }
    controller.finalizing = true;
    setCaptureState("finalizing");
    try {
      const receipt = await finishMatterSpeechCapture(
        tenantId,
        matterId,
        controller.id,
        controller.nextSequenceNumber - 1,
      );
      if (
        receipt.status !== "completed" ||
        !receipt.evidence_item ||
        !receipt.evidence_version
      ) {
        captureRef.current = null;
        stopCaptureTracks(controller);
        setCapturePendingBytes(0);
        setCaptureState("idle");
        setCaptureError(
          receipt.status === "failed"
            ? "录音未通过恶意文件扫描或完整性检查，未登记为案件材料；服务器正在清理暂存分片。"
            : `录音会话已结束（${receipt.status}），未登记为案件材料。`,
        );
        return;
      }
      await evidence.refetch();
      setSelectedItemId(receipt.evidence_item.id);
      setSelectedVersionId(receipt.evidence_version.id);
      try {
        const created = await createTask.mutateAsync({
          evidenceItemId: receipt.evidence_item.id,
          evidenceVersionId: receipt.evidence_version.id,
        });
        setSelectedTaskId(created.id);
      } catch (error) {
        setCaptureError(
          error instanceof Error
            ? `录音已保存并通过扫描，但启动转写失败：${error.message}`
            : "录音已保存并通过扫描，但启动转写失败。",
        );
      }
      await transcriptions.refetch();
      captureRef.current = null;
      stopCaptureTracks(controller);
      setCapturePendingBytes(0);
      setCaptureState("idle");
    } catch (error) {
      controller.finalizing = false;
      setCaptureState("upload_error");
      setCaptureError(
        error instanceof Error ? error.message : "无法完成录音保存。",
      );
    }
  };

  const drainCaptureQueue = async (controller: LiveCaptureController) => {
    if (controller.uploading || controller.cancelled || controller.overflowed) {
      return;
    }
    controller.uploading = true;
    let failed = false;
    try {
      while (controller.queue.length > 0 && !controller.cancelled) {
        const queued = controller.queue[0];
        if (!queued) break;
        queued.sequenceNumber ??= controller.nextSequenceNumber;
        const sequenceNumber = queued.sequenceNumber;
        let digest: ArrayBuffer;
        try {
          digest = await crypto.subtle.digest(
            "SHA-256",
            await queued.blob.arrayBuffer(),
          );
        } catch {
          failed = true;
          if (controller.recorder.state === "recording") {
            controller.recorder.pause();
          }
          setCaptureState("upload_error");
          setCaptureError(
            "无法为录音分片计算完整性摘要，请检查浏览器安全上下文后重试。",
          );
          break;
        }
        const sha256 = Array.from(new Uint8Array(digest))
          .map((value) => value.toString(16).padStart(2, "0"))
          .join("");
        try {
          const receipt = await uploadMatterSpeechCaptureChunk(
            tenantId,
            matterId,
            controller.id,
            sequenceNumber,
            queued.blob,
            sha256,
          );
          if (
            receipt.accepted_sequence_number !== sequenceNumber ||
            receipt.next_sequence_number < sequenceNumber + 1
          ) {
            throw new Error("服务器没有确认当前录音分片。");
          }
          controller.nextSequenceNumber = receipt.next_sequence_number;
          controller.queue.shift();
          controller.queueBytes -= queued.blob.size;
          setCapturePendingBytes(controller.queueBytes);
        } catch (error) {
          failed = true;
          if (controller.recorder.state === "recording") {
            controller.recorder.pause();
          }
          setCaptureState("upload_error");
          setCaptureError(
            error instanceof Error
              ? `录音已暂停，未确认的分片保留在当前页面内存，可重试上传。${error.message}`
              : "录音已暂停，未确认的分片保留在当前页面内存，可重试上传。",
          );
          break;
        }
      }
    } finally {
      controller.uploading = false;
      if (
        !failed &&
        !controller.cancelled &&
        controller.queueBytes < 4 * 1024 * 1024
      ) {
        if (!controller.stopped && controller.recorder.state === "paused") {
          controller.recorder.resume();
          setCaptureState("recording");
        }
        if (controller.stopped && controller.queue.length === 0) {
          void finalizeCapture(controller);
        }
      }
    }
  };

  const retryCaptureUpload = async () => {
    const controller = captureRef.current;
    if (!controller || controller.cancelled) return;
    setCaptureError(null);
    try {
      const remote = await getMatterSpeechCapture(
        tenantId,
        matterId,
        controller.id,
      );
      if (remote.status === "completed") {
        controller.stopped = true;
        controller.queue.length = 0;
        controller.queueBytes = 0;
        controller.nextSequenceNumber = remote.next_sequence_number;
        await finalizeCapture(controller);
        return;
      }
      if (remote.status !== "open") {
        throw new Error("录音会话已关闭，无法继续上传。");
      }
      while (
        controller.queue[0]?.sequenceNumber !== null &&
        controller.queue[0]?.sequenceNumber !== undefined &&
        controller.queue[0].sequenceNumber < remote.next_sequence_number
      ) {
        const accepted = controller.queue.shift();
        if (accepted) controller.queueBytes -= accepted.blob.size;
      }
      controller.nextSequenceNumber = remote.next_sequence_number;
      setCapturePendingBytes(controller.queueBytes);
      setCaptureState(controller.stopped ? "stopping" : "recording");
      await drainCaptureQueue(controller);
      if (
        !controller.stopped &&
        controller.recorder.state === "paused" &&
        !controller.uploading &&
        controller.queue.length === 0
      ) {
        controller.recorder.resume();
        setCaptureState("recording");
      }
    } catch (error) {
      setCaptureState("upload_error");
      setCaptureError(
        error instanceof Error ? error.message : "无法恢复录音上传。",
      );
    }
  };

  const startCapture = async () => {
    if (!captureSupportedType) return;
    setCaptureError(null);
    setActionError(null);
    let stream: MediaStream | null = null;
    let createdId: string | null = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const session = await createMatterSpeechCapture(tenantId, matterId, {
        title: captureTitle.trim() || "案件实时录音",
        media_type: captureSupportedType,
      });
      createdId = session.id;
      const recorder = new MediaRecorder(stream, {
        mimeType: captureSupportedType,
      });
      const controller: LiveCaptureController = {
        id: session.id,
        stream,
        recorder,
        maxChunkBytes: session.max_chunk_bytes,
        maxTotalBytes: session.max_total_bytes,
        nextSequenceNumber: session.next_sequence_number,
        queue: [],
        queueBytes: 0,
        capturedBytes: 0,
        uploading: false,
        stopped: false,
        cancelled: false,
        finalizing: false,
        overflowed: false,
      };
      captureRef.current = controller;
      recorder.addEventListener("dataavailable", (event: BlobEvent) => {
        if (controller.cancelled || !event.data.size) return;
        controller.capturedBytes += event.data.size;
        if (controller.capturedBytes > controller.maxTotalBytes) {
          controller.overflowed = true;
          setCaptureError("录音已达到服务器大小上限，已停止并取消本次录音。");
          setCaptureState("upload_error");
          if (recorder.state !== "inactive") recorder.stop();
          void cancelCapture(controller);
          return;
        }
        for (
          let offset = 0;
          offset < event.data.size;
          offset += controller.maxChunkBytes
        ) {
          const blob = event.data.slice(
            offset,
            Math.min(offset + controller.maxChunkBytes, event.data.size),
            "application/octet-stream",
          );
          controller.queue.push({ blob, sequenceNumber: null });
          controller.queueBytes += blob.size;
        }
        setCapturePendingBytes(controller.queueBytes);
        if (
          controller.queueBytes >= 8 * 1024 * 1024 &&
          recorder.state === "recording"
        ) {
          recorder.pause();
          setCaptureState("paused");
        }
        void drainCaptureQueue(controller);
      });
      recorder.addEventListener("stop", () => {
        controller.stopped = true;
        setCaptureState("stopping");
        void drainCaptureQueue(controller);
      });
      recorder.addEventListener("error", () => {
        setCaptureError(
          "浏览器录音发生错误；请重试上传已确认的分片或取消本次录音。",
        );
        setCaptureState("upload_error");
      });
      recorder.start(1000);
      setCapturePendingBytes(0);
      setCaptureState("recording");
    } catch (error) {
      stream?.getTracks().forEach((track) => track.stop());
      captureRef.current = null;
      setCaptureState("idle");
      if (createdId) {
        void cancelMatterSpeechCapture(tenantId, matterId, createdId).catch(
          () => undefined,
        );
      }
      setCaptureError(
        error instanceof Error
          ? `无法开始麦克风录音：${error.message}`
          : "无法开始麦克风录音。",
      );
    }
  };

  const stopCapture = () => {
    const controller = captureRef.current;
    if (!controller || controller.recorder.state === "inactive") return;
    setCaptureState("stopping");
    controller.recorder.stop();
  };

  useEffect(
    () => () => {
      const controller = captureRef.current;
      if (!controller) return;
      controller.cancelled = true;
      controller.queue.length = 0;
      stopCaptureTracks(controller);
      if (controller.recorder.state !== "inactive") controller.recorder.stop();
      void cancelMatterSpeechCapture(tenantId, matterId, controller.id).catch(
        () => undefined,
      );
      captureRef.current = null;
    },
    [matterId, tenantId],
  );

  useEffect(() => {
    if (!selectedTaskId && tasks[0]) setSelectedTaskId(tasks[0].id);
  }, [selectedTaskId, tasks]);

  useEffect(() => {
    if (!taskEvidenceItemId || !taskEvidenceVersionId) return;
    const controller = new AbortController();
    let objectUrl: string | null = null;
    setMediaUrl(null);
    setMediaError(null);
    void fetchEvidenceContent(
      tenantId,
      matterId,
      taskEvidenceItemId,
      taskEvidenceVersionId,
      controller.signal,
    )
      .then((blob) => {
        objectUrl = URL.createObjectURL(blob);
        setMediaUrl(objectUrl);
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          setMediaError(
            error instanceof Error
              ? error.message
              : "无法读取受保护的音视频原件。",
          );
        }
      });
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [matterId, taskEvidenceItemId, taskEvidenceVersionId, tenantId]);

  useEffect(() => {
    if (!latestTranscript || !latestVersionId) return;
    let previousEnd = 0;
    const editable = latestTranscript.segments.map((segment) => {
      const separatorBefore = latestTranscript.text.slice(
        previousEnd,
        segment.charStart,
      );
      previousEnd = segment.charEnd;
      return { ...segment, separatorBefore };
    });
    setDraftSegments(editable);
    setDraftSpeakers(latestTranscript.speakers ?? []);
    setTrailingText(latestTranscript.text.slice(previousEnd));
  }, [latestVersionId, latestTranscript]);

  const uploadAudio = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setUploadError(null);
    setActionError(null);
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const file = form.get("file");
    const titleValue = form.get("title");
    const title = typeof titleValue === "string" ? titleValue.trim() : "";
    if (
      !(file instanceof File) ||
      file.size === 0 ||
      !acceptedTypes.includes(file.type)
    ) {
      setUploadError("请选择当前服务器允许的音视频格式文件。");
      return;
    }
    if (file.size > 50 * 1024 * 1024) {
      setUploadError("文件不能超过 50 MiB。");
      return;
    }
    try {
      const result = await upload.mutateAsync({
        title: title || file.name,
        file,
      });
      setSelectedItemId(result.evidence_item.id);
      setSelectedVersionId(result.evidence_version.id);
      formElement.reset();
    } catch (error) {
      setUploadError(
        error instanceof Error ? error.message : "音视频上传失败。",
      );
    }
  };

  const startTranscription = async () => {
    if (!selectedItemId || !selectedVersion) return;
    setActionError(null);
    try {
      const created = await createTask.mutateAsync({
        evidenceItemId: selectedItemId,
        evidenceVersionId: selectedVersion.id,
      });
      setSelectedTaskId(created.id);
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : "无法启动本地语音转写。",
      );
    }
  };

  const saveReview = async () => {
    if (!task || !latestVersion || !latestTranscript) return;
    setActionError(null);
    let text = "";
    const segments = draftSegments.map((segment) => {
      text += segment.separatorBefore;
      const charStart = text.length;
      text += segment.text;
      return {
        text: segment.text,
        charStart,
        charEnd: text.length,
        startMs: segment.startMs,
        endMs: segment.endMs,
        speakerId: segment.speakerId ?? null,
      };
    });
    text += trailingText;
    try {
      await reviewTask.mutateAsync({
        taskId: task.id,
        input: {
          expected_version: latestVersion.version_number,
          text,
          segments,
          speakers: draftSpeakers,
        },
      });
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : "无法保存律师校对版本。",
      );
    }
  };

  const changeSegment = (index: number, patch: Partial<EditableSegment>) => {
    setDraftSegments((current) =>
      current.map((segment, currentIndex) =>
        currentIndex === index ? { ...segment, ...patch } : segment,
      ),
    );
  };

  return (
    <section className="mb-7" aria-labelledby="matter-speech-title">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <AudioLinesIcon className="size-4" />
          <h3 id="matter-speech-title" className="text-sm font-semibold">
            庭审录音与语音转写
          </h3>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => void transcriptions.refetch()}
          disabled={transcriptions.isFetching}
        >
          {transcriptions.isFetching ? (
            <LoaderCircleIcon className="animate-spin" />
          ) : (
            <RefreshCwIcon />
          )}
          刷新
        </Button>
      </div>

      <p className="text-muted-foreground mb-3 text-xs">
        识别结果只作为机器初稿。确认文字、说话人和时间位置后，律师校对版本才会标记为已复核；机器初稿不用于法律引用。
      </p>

      {transcriptions.isError && (
        <p role="alert" className="text-destructive mb-3 text-sm">
          {transcriptions.error.message}
        </p>
      )}

      {available ? (
        <div className="space-y-4 rounded-lg border p-4">
          {liveCaptureAvailable && (
            <div className="space-y-3 rounded-md border p-3">
              <div>
                <h4 className="text-sm font-medium">案件实时录音</h4>
                <p className="text-muted-foreground mt-1 text-xs">
                  浏览器仅在本页面内暂存未确认分片；确认后直传律所服务器对象存储。保存前完成恶意文件扫描。
                </p>
              </div>
              {captureSupportedType ? (
                <>
                  <label className="block max-w-xl space-y-1 text-sm">
                    <span>录音名称</span>
                    <input
                      value={captureTitle}
                      onChange={(event) => setCaptureTitle(event.target.value)}
                      maxLength={240}
                      disabled={captureState !== "idle"}
                      placeholder="例如：2026 年 10 月 3 日庭审录音"
                      className="bg-background w-full rounded-md border px-3 py-2"
                    />
                  </label>
                  <div className="flex flex-wrap items-center gap-2">
                    {captureState === "idle" ? (
                      <Button type="button" onClick={() => void startCapture()}>
                        <MicIcon />
                        开始麦克风录音
                      </Button>
                    ) : (
                      <>
                        {(captureState === "recording" ||
                          captureState === "paused") && (
                          <Button
                            type="button"
                            onClick={stopCapture}
                            variant="outline"
                          >
                            <AudioLinesIcon />
                            停止并保存
                          </Button>
                        )}
                        {captureState === "upload_error" && (
                          <Button
                            type="button"
                            onClick={() => void retryCaptureUpload()}
                            variant="outline"
                          >
                            <RefreshCwIcon />
                            重试上传
                          </Button>
                        )}
                        <Button
                          type="button"
                          onClick={() => void cancelCapture()}
                          variant="outline"
                        >
                          <XCircleIcon />
                          取消录音
                        </Button>
                      </>
                    )}
                    {captureState === "recording" && (
                      <span role="status" className="text-sm">
                        正在录音并上传已完成分片
                      </span>
                    )}
                    {captureState === "paused" && (
                      <span role="status" className="text-sm">
                        上传队列较长，录音已暂时暂停
                      </span>
                    )}
                    {captureState === "stopping" && (
                      <span role="status" className="text-sm">
                        正在上传最后分片
                      </span>
                    )}
                    {captureState === "finalizing" && (
                      <span role="status" className="text-sm">
                        正在扫描并登记案件原件
                      </span>
                    )}
                    {captureState === "upload_error" && (
                      <span role="status" className="text-sm">
                        上传暂停，待处理分片 {capturePendingBytes} 字节
                      </span>
                    )}
                  </div>
                  {captureError && (
                    <p role="alert" className="text-destructive text-sm">
                      {captureError}
                    </p>
                  )}
                </>
              ) : (
                <p className="text-muted-foreground text-sm">
                  当前浏览器没有支持的录音格式或麦克风接口。
                </p>
              )}
            </div>
          )}
          <form
            onSubmit={(event) => void uploadAudio(event)}
            className="grid gap-3 sm:grid-cols-2"
          >
            <label className="space-y-1 text-sm">
              <span>音视频名称</span>
              <input
                name="title"
                maxLength={240}
                placeholder="例如：2026 年 10 月 3 日庭审录音"
                className="bg-background w-full rounded-md border px-3 py-2"
              />
            </label>
            <label className="space-y-1 text-sm">
              <span>音视频原件</span>
              <input
                name="file"
                type="file"
                required
                accept={acceptedTypes.join(",")}
                className="bg-background w-full rounded-md border px-3 py-2 text-xs"
              />
            </label>
            <div className="flex flex-wrap items-center gap-2 sm:col-span-2">
              <Button
                type="submit"
                variant="outline"
                size="sm"
                disabled={upload.isPending}
              >
                {upload.isPending ? (
                  <LoaderCircleIcon className="animate-spin" />
                ) : (
                  <UploadIcon />
                )}
                上传并扫描
              </Button>
              <span className="text-muted-foreground text-xs">
                单个文件最多 50 MiB；扫描通过后才能排入本地识别。
              </span>
            </div>
          </form>
          {uploadError && (
            <p role="alert" className="text-destructive text-sm">
              {uploadError}
            </p>
          )}
          <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
            <label className="space-y-1 text-sm">
              <span>已扫描的音视频材料</span>
              <select
                value={selectedItemId ?? ""}
                onChange={(event) => {
                  setSelectedItemId(event.target.value || null);
                  setSelectedVersionId(null);
                }}
                className="bg-background w-full rounded-md border px-3 py-2"
              >
                <option value="">选择案件材料</option>
                {selectableEvidence.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.title}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1 text-sm">
              <span>原件版本</span>
              <select
                value={selectedVersionId ?? ""}
                onChange={(event) =>
                  setSelectedVersionId(event.target.value || null)
                }
                disabled={!selectedItemId || versions.isLoading}
                className="bg-background w-full rounded-md border px-3 py-2"
              >
                <option value="">选择通过扫描的音视频版本</option>
                {(versions.data ?? [])
                  .filter((version) => isMediaVersion(version, acceptedTypes))
                  .map((version) => (
                    <option key={version.id} value={version.id}>
                      v{version.version_number} · {version.original_filename} ·{" "}
                      {version.media_type}
                    </option>
                  ))}
              </select>
            </label>
            <div className="flex items-end">
              <Button
                type="button"
                onClick={() => void startTranscription()}
                disabled={!selectedVersion || createTask.isPending}
              >
                {createTask.isPending ? (
                  <LoaderCircleIcon className="animate-spin" />
                ) : (
                  <AudioLinesIcon />
                )}
                开始本地转写
              </Button>
            </div>
          </div>
          {actionError && (
            <p role="alert" className="text-destructive text-sm">
              {actionError}
            </p>
          )}
        </div>
      ) : (
        <p className="rounded-lg border p-4 text-sm">
          当前候选环境未启用已验收的本地语音模型；上传和转写入口保持关闭。管理员完成模型与许可证检查后可启用。
        </p>
      )}

      {tasks.length > 0 && (
        <div className="mt-4 grid gap-4 lg:grid-cols-[240px_1fr]">
          <div className="space-y-2" aria-label="语音转写任务">
            {tasks.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setSelectedTaskId(item.id)}
                aria-pressed={selectedTaskId === item.id}
                className={`w-full rounded-md border p-3 text-left text-sm ${selectedTaskId === item.id ? "bg-muted" : ""}`}
              >
                <span className="block font-medium">
                  {STATUS_LABEL[item.status] ?? item.status}
                </span>
                <span className="text-muted-foreground mt-1 block text-xs">
                  {item.media_type} · v{item.current_version_number}
                </span>
              </button>
            ))}
          </div>
          {task && (
            <div className="min-w-0 space-y-3 rounded-lg border p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h4 className="font-medium">
                    {STATUS_LABEL[task.status] ?? task.status}
                  </h4>
                  <p className="text-muted-foreground text-xs">
                    原件 SHA-256：{task.source_sha256.slice(0, 16)}…
                  </p>
                </div>
                {["queued", "processing"].includes(task.status) && (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={cancelTask.isPending}
                    onClick={() =>
                      void cancelTask
                        .mutateAsync(task.id)
                        .catch((error: unknown) =>
                          setActionError(
                            error instanceof Error
                              ? error.message
                              : "无法取消任务。",
                          ),
                        )
                    }
                  >
                    <XCircleIcon />
                    取消任务
                  </Button>
                )}
              </div>

              {detail.isError && (
                <p role="alert" className="text-destructive text-sm">
                  {detail.error.message}
                </p>
              )}
              {mediaError && (
                <p role="alert" className="text-destructive text-sm">
                  {mediaError}
                </p>
              )}
              {mediaUrl &&
                (task.media_type.startsWith("video/") ? (
                  <video
                    ref={(node) => {
                      mediaRef.current = node;
                    }}
                    controls
                    src={mediaUrl}
                    className="max-h-80 w-full rounded-md bg-black"
                  />
                ) : (
                  <audio
                    ref={(node) => {
                      mediaRef.current = node;
                    }}
                    controls
                    src={mediaUrl}
                    className="w-full"
                  />
                ))}

              {latestTranscript && latestVersion ? (
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-medium">
                      {latestVersion.origin === "asr"
                        ? "机器初稿 · 未人工复核"
                        : "律师校对版本"}
                      <span className="text-muted-foreground ml-2 text-xs">
                        版本 {latestVersion.version_number}
                      </span>
                    </p>
                    {canReview &&
                      ["awaiting_review", "reviewed"].includes(task.status) && (
                        <Button
                          type="button"
                          size="sm"
                          onClick={() => void saveReview()}
                          disabled={reviewTask.isPending}
                        >
                          {reviewTask.isPending && (
                            <LoaderCircleIcon className="animate-spin" />
                          )}
                          保存为律师校对版本
                        </Button>
                      )}
                  </div>
                  <div className="max-h-80 space-y-2 overflow-auto rounded-md border p-3">
                    {draftSegments.map((segment, index) => (
                      <div
                        key={`${segment.charStart}-${index}`}
                        className="grid gap-2 sm:grid-cols-[95px_1fr]"
                      >
                        <button
                          type="button"
                          className="text-primary h-fit text-left text-xs underline"
                          onClick={() => {
                            if (mediaRef.current) {
                              mediaRef.current.currentTime =
                                segment.startMs / 1000;
                              void mediaRef.current.play();
                            }
                          }}
                        >
                          {Math.floor(segment.startMs / 1000)}s –{" "}
                          {Math.floor(segment.endMs / 1000)}s
                        </button>
                        {canReview &&
                        ["awaiting_review", "reviewed"].includes(
                          task.status,
                        ) ? (
                          <textarea
                            aria-label={`校对片段 ${index + 1}`}
                            value={segment.text}
                            rows={Math.min(
                              5,
                              Math.max(2, Math.ceil(segment.text.length / 70)),
                            )}
                            onChange={(event) =>
                              changeSegment(index, { text: event.target.value })
                            }
                            className="bg-background w-full rounded-md border px-3 py-2 text-sm"
                          />
                        ) : (
                          <p className="text-sm whitespace-pre-wrap">
                            {segment.text}
                          </p>
                        )}
                      </div>
                    ))}
                    {draftSegments.length === 0 && (
                      <p className="text-muted-foreground text-sm">
                        没有可显示的识别片段。
                      </p>
                    )}
                  </div>
                  {draftSpeakers.length > 0 && (
                    <div className="flex flex-wrap gap-3 text-xs">
                      {draftSpeakers.map((speaker, index) => (
                        <label
                          key={speaker.id}
                          className="flex items-center gap-2"
                        >
                          <span>{speaker.id}</span>
                          <input
                            value={speaker.label}
                            disabled={
                              !canReview ||
                              !["awaiting_review", "reviewed"].includes(
                                task.status,
                              )
                            }
                            aria-label={`说话人 ${index + 1} 名称`}
                            onChange={(event) =>
                              setDraftSpeakers((current) =>
                                current.map((value) =>
                                  value.id === speaker.id
                                    ? { ...value, label: event.target.value }
                                    : value,
                                ),
                              )
                            }
                            className="bg-background w-36 rounded-md border px-2 py-1"
                          />
                        </label>
                      ))}
                    </div>
                  )}
                  <p className="text-muted-foreground text-xs">
                    {latestTranscript.approxAlignment
                      ? "时间位置为估算值，请逐段对照原件。"
                      : "时间位置来自本地说话人分段，请逐段对照原件。"}
                    {latestTranscript.warnings?.length
                      ? ` 模型提示：${latestTranscript.warnings.join("、")}`
                      : ""}
                  </p>
                </div>
              ) : task.status === "failed" ? (
                <p role="alert" className="text-destructive text-sm">
                  本地识别失败（{task.error_code ?? "未知错误"}
                  ）。请检查模型配置后重试。
                </p>
              ) : (
                <p role="status" className="text-muted-foreground text-sm">
                  等待本地工作进程完成识别…
                </p>
              )}
              {actionError && (
                <p role="alert" className="text-destructive text-sm">
                  {actionError}
                </p>
              )}
              {detail.data?.events && (
                <details>
                  <summary className="cursor-pointer text-xs font-medium">
                    查看任务状态历史（{detail.data.events.length}）
                  </summary>
                  <ol className="mt-2 space-y-1 text-xs">
                    {detail.data.events.map((event) => (
                      <li key={event.id}>
                        {event.sequence_number}. {event.event_type} ·{" "}
                        {new Date(event.created_at).toLocaleString("zh-CN")}
                      </li>
                    ))}
                  </ol>
                </details>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
