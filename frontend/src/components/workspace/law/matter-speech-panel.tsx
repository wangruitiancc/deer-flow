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
  fetchEvidenceContent,
  useCancelLawSpeechTranscription,
  useCreateLawSpeechCitation,
  useCreateLawSpeechTranscription,
  useLawEvidence,
  useLawEvidenceVersions,
  useLawCaseWorkbench,
  useLawCaseWorkbenchEvents,
  useLawSpeechTranscription,
  useLawSpeechCitations,
  useLawSpeechTranscriptions,
  useReviewLawSpeechTranscription,
  useUploadLawEvidence,
  type EvidenceVersion,
  type MatterMemberRole,
  type SpeechTranscriptSegment,
  type SpeechTranscriptSpeaker,
} from "@/core/law";

import { useSpeechCapture } from "./use-speech-capture";

type EditableSegment = SpeechTranscriptSegment & { separatorBefore: string };

function editableTranscript(transcript: {
  text: string;
  segments: SpeechTranscriptSegment[];
}) {
  let previousEnd = 0;
  const segments = transcript.segments.map((segment) => {
    const separatorBefore = transcript.text.slice(
      previousEnd,
      segment.charStart,
    );
    previousEnd = segment.charEnd;
    return { ...segment, separatorBefore };
  });
  return { segments, trailingText: transcript.text.slice(previousEnd) };
}

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
  userId,
  membershipId,
}: {
  tenantId: string;
  matterId: string;
  matterRole: MatterMemberRole;
  userId: string;
  membershipId: string;
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
  const speechCitations = useLawSpeechCitations(
    tenantId,
    matterId,
    selectedTaskId,
  );
  const createSpeechCitation = useCreateLawSpeechCitation(tenantId, matterId);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [mediaUrl, setMediaUrl] = useState<string | null>(null);
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [draftSegments, setDraftSegments] = useState<EditableSegment[]>([]);
  const [draftSpeakers, setDraftSpeakers] = useState<SpeechTranscriptSpeaker[]>(
    [],
  );
  const [trailingText, setTrailingText] = useState("");
  const [reviewedText, setReviewedText] = useState(false);
  const [reviewedTimeRanges, setReviewedTimeRanges] = useState(false);
  const [draftConflictVersionId, setDraftConflictVersionId] = useState<
    string | null
  >(null);
  const [citationSelection, setCitationSelection] = useState<{
    start: number;
    end: number;
  } | null>(null);
  const draftTaskIdRef = useRef<string | null>(null);
  const draftBaselineRef = useRef<{
    versionId: string;
    versionNumber: number;
  } | null>(null);
  const draftDirtyRef = useRef(false);
  const mediaRef = useRef<HTMLMediaElement | null>(null);
  const acceptedTypes = transcriptions.data?.supported_media_types ?? [];
  const available = transcriptions.data?.transcription_available ?? false;
  const liveCaptureAvailable =
    transcriptions.data?.live_capture_available ?? false;
  const captureWorkbench = useLawCaseWorkbench(
    tenantId,
    matterId,
    liveCaptureAvailable,
  );
  useLawCaseWorkbenchEvents(
    tenantId,
    matterId,
    liveCaptureAvailable ? captureWorkbench.data?.revision : undefined,
  );
  const capture = useSpeechCapture({
    tenantId,
    matterId,
    userId,
    membershipId,
    available: liveCaptureAvailable,
    onCompleted: (session) => {
      void evidence.refetch();
      void transcriptions.refetch();
      if (session.evidence_item_id) setSelectedItemId(session.evidence_item_id);
      if (session.evidence_version_id)
        setSelectedVersionId(session.evidence_version_id);
      if (session.transcription_task_id)
        setSelectedTaskId(session.transcription_task_id);
    },
  });
  const captureState = capture.state;
  const captureError = capture.error;
  const captureTitle = capture.title;
  const captureSupported = capture.supported;
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
    if (draftTaskIdRef.current !== (task?.id ?? null)) {
      draftTaskIdRef.current = task?.id ?? null;
      draftBaselineRef.current = null;
      draftDirtyRef.current = false;
      setDraftConflictVersionId(null);
      setDraftSegments([]);
      setDraftSpeakers([]);
      setTrailingText("");
      setReviewedText(false);
      setReviewedTimeRanges(false);
    }
    if (!latestTranscript || !latestVersionId || !latestVersion) return;
    const baseline = draftBaselineRef.current;
    if (
      baseline?.versionId === latestVersionId ||
      (baseline && latestVersion.version_number < baseline.versionNumber)
    )
      return;
    if (baseline && draftDirtyRef.current) {
      setDraftConflictVersionId(latestVersionId);
      return;
    }
    const editable = editableTranscript(latestTranscript);
    setDraftSegments(editable.segments);
    setDraftSpeakers(latestTranscript.speakers ?? []);
    setTrailingText(editable.trailingText);
    draftBaselineRef.current = {
      versionId: latestVersionId,
      versionNumber: latestVersion.version_number,
    };
    draftDirtyRef.current = false;
    setDraftConflictVersionId(null);
    setReviewedText(false);
    setReviewedTimeRanges(false);
  }, [latestVersion, latestVersionId, latestTranscript, task?.id]);

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
    if (!reviewedText || !reviewedTimeRanges) {
      setActionError(
        "保存前请分别确认文字内容和每段时间范围已对照原音频复核。",
      );
      return;
    }
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
      const receipt = await reviewTask.mutateAsync({
        taskId: task.id,
        input: {
          expected_version: latestVersion.version_number,
          text,
          segments,
          speakers: draftSpeakers,
          reviewed_text: reviewedText,
          reviewed_time_ranges: reviewedTimeRanges,
        },
      });
      draftBaselineRef.current = {
        versionId: receipt.version.id,
        versionNumber: receipt.version.version_number,
      };
      draftDirtyRef.current = false;
      setDraftConflictVersionId(null);
      setReviewedText(false);
      setReviewedTimeRanges(false);
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : "无法保存律师校对版本。",
      );
    }
  };

  const changeSegment = (index: number, patch: Partial<EditableSegment>) => {
    draftDirtyRef.current = true;
    setDraftSegments((current) =>
      current.map((segment, currentIndex) =>
        currentIndex === index ? { ...segment, ...patch } : segment,
      ),
    );
  };

  const discardReviewDraft = () => {
    if (!latestTranscript || !latestVersion) return;
    const editable = editableTranscript(latestTranscript);
    setDraftSegments(editable.segments);
    setDraftSpeakers(latestTranscript.speakers ?? []);
    setTrailingText(editable.trailingText);
    draftBaselineRef.current = {
      versionId: latestVersion.id,
      versionNumber: latestVersion.version_number,
    };
    draftDirtyRef.current = false;
    setDraftConflictVersionId(null);
    setReviewedText(false);
    setReviewedTimeRanges(false);
  };

  const createCitation = async () => {
    if (!task || !latestVersion || !citationSelection) return;
    setActionError(null);
    try {
      await createSpeechCitation.mutateAsync({
        taskId: task.id,
        input: {
          transcript_version_id: latestVersion.id,
          start_character: citationSelection.start,
          end_character: citationSelection.end,
        },
      });
      setCitationSelection(null);
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : "无法创建录音时间引用。",
      );
    }
  };

  const jumpToAudio = (startMs: number) => {
    if (!mediaRef.current) return;
    mediaRef.current.currentTime = startMs / 1000;
    void mediaRef.current.play();
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
                  麦克风仅在你点击后开启。浏览器以 16 kHz 单声道 PCM
                  采集；分片先加密保存到本机，服务器确认后删除本机副本。刷新后只补传已保存分片，不会自动重新启麦。
                </p>
              </div>
              {captureSupported ? (
                <>
                  <label className="block max-w-xl space-y-1 text-sm">
                    <span>录音名称</span>
                    <input
                      value={captureTitle}
                      onChange={(event) => capture.setTitle(event.target.value)}
                      maxLength={240}
                      disabled={captureState !== "idle"}
                      placeholder="例如：2026 年 10 月 3 日庭审录音"
                      className="bg-background w-full rounded-md border px-3 py-2"
                    />
                  </label>
                  <div className="flex flex-wrap items-center gap-2">
                    {captureState === "idle" ? (
                      <Button
                        type="button"
                        onClick={() => void capture.start()}
                      >
                        <MicIcon />
                        开始麦克风录音
                      </Button>
                    ) : (
                      <>
                        {captureState === "starting" && (
                          <>
                            <Button type="button" disabled variant="outline">
                              <MicIcon />
                              正在准备麦克风…
                            </Button>
                            <Button
                              type="button"
                              onClick={() => void capture.cancel()}
                              variant="outline"
                            >
                              <XCircleIcon />
                              取消启动
                            </Button>
                          </>
                        )}
                        {(captureState === "recording" ||
                          capture.captureActive) && (
                          <Button
                            type="button"
                            onClick={() => void capture.stop()}
                            variant="outline"
                          >
                            <AudioLinesIcon />
                            停止并保存
                          </Button>
                        )}
                        {(captureState === "upload_error" ||
                          captureState === "offline_buffering" ||
                          captureState === "interrupted") && (
                          <Button
                            type="button"
                            onClick={() => void capture.retry()}
                            variant="outline"
                          >
                            <RefreshCwIcon />
                            补传并继续保存
                          </Button>
                        )}
                        {captureState !== "starting" &&
                          captureState !== "revoked" && (
                            <Button
                              type="button"
                              onClick={() => void capture.cancel()}
                              variant="outline"
                            >
                              <XCircleIcon />
                              取消录音
                            </Button>
                          )}
                      </>
                    )}
                    {captureState === "starting" && (
                      <span role="status" className="text-sm">
                        正在准备 16 kHz 录音…
                      </span>
                    )}
                    {captureState === "recording" && (
                      <span role="status" className="text-sm">
                        正在采集；本机保存、服务器确认和识别进度分开显示
                      </span>
                    )}
                    {captureState === "offline_buffering" && (
                      <span role="status" className="text-sm">
                        网络不可用；采集内容保留在加密本机暂存中
                      </span>
                    )}
                    {captureState === "stopping" && (
                      <span role="status" className="text-sm">
                        麦克风已停止，正在提交最后一片本机数据
                      </span>
                    )}
                    {captureState === "finalizing" && (
                      <span role="status" className="text-sm">
                        正在完整扫描原件并排入正式转写；实时预览仍是临时稿
                      </span>
                    )}
                    {captureState === "interrupted" && (
                      <span role="status" className="text-sm">
                        正在恢复持久保存的分片，不会自动启麦
                      </span>
                    )}
                    {captureState === "upload_error" && (
                      <span role="status" className="text-sm">
                        上传或本机暂存遇到问题；未确认数据没有被当作服务器已保存
                      </span>
                    )}
                  </div>
                  <p className="text-muted-foreground text-xs">
                    已采集 {Math.floor(capture.capturedSamples / 16_000)} 秒 ·
                    本机已保存 {Math.floor(capture.localSavedSamples / 16_000)}{" "}
                    秒 · 服务器已确认{" "}
                    {Math.floor(capture.serverConfirmedSamples / 16_000)} 秒 ·
                    已识别预览 {Math.floor(capture.recognizedSamples / 16_000)}{" "}
                    秒
                  </p>
                  {captureError && (
                    <p role="alert" className="text-destructive text-sm">
                      {captureError}
                    </p>
                  )}
                </>
              ) : (
                <p className="text-muted-foreground text-sm">
                  {captureError ??
                    "当前浏览器无法建立受支持的 16 kHz 录音能力；麦克风入口已关闭，可继续使用文件上传。"}
                </p>
              )}
              {capture.serverRecoverable.length > 0 && (
                <section
                  aria-label="服务器可恢复录音"
                  className="space-y-2 rounded border p-3"
                >
                  <p className="text-sm">
                    另一个浏览器可能仍在录音。这里只保存服务器已确认的部分；请确认原录音已经中断后再操作。
                  </p>
                  {capture.serverRecoverable.map((item) => (
                    <Button
                      key={item.id}
                      type="button"
                      variant="outline"
                      disabled={captureState !== "idle"}
                      onClick={() => void capture.recoverServerCapture(item.id)}
                    >
                      确认录音已中断，保存服务器录音 · {item.title}
                    </Button>
                  ))}
                </section>
              )}
              {capture.previewWindows.length > 0 && (
                <div
                  className="space-y-2 rounded border p-3"
                  aria-label="录音临时识别预览"
                >
                  <p className="text-xs font-medium">
                    机器预览 · 未审核，不可引用
                  </p>
                  {capture.previewWindows.map((window) => (
                    <div key={window.window_id} className="text-sm">
                      <span className="text-muted-foreground mr-2 text-xs">
                        {Math.floor(window.start_sample / 16_000)}–
                        {Math.floor(window.end_sample / 16_000)} 秒
                      </span>
                      {window.transcript?.text ??
                        "本窗口没有可显示的识别文字。"}
                    </div>
                  ))}
                </div>
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
              {detail.data?.task.processing_deferred_reason ===
                "tenant_data_exit_frozen" && (
                <p role="status" className="rounded-md border p-3 text-sm">
                  案件正在进行数据退出冻结，语音识别暂缓；解除冻结后工作进程会自动恢复。
                </p>
              )}
              {detail.data?.task.processing_deferred_reason ===
                "write_gate_unavailable" && (
                <p role="status" className="rounded-md border p-3 text-sm">
                  当前无法确认案件写入门禁，语音识别已暂停；服务恢复后会重新检查。
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
                          disabled={
                            reviewTask.isPending ||
                            !reviewedText ||
                            !reviewedTimeRanges
                          }
                        >
                          {reviewTask.isPending && (
                            <LoaderCircleIcon className="animate-spin" />
                          )}
                          保存为律师校对版本
                        </Button>
                      )}
                  </div>
                  {draftConflictVersionId && (
                    <div
                      role="alert"
                      className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-amber-500/50 p-3 text-sm"
                    >
                      <span>
                        该转写已有新版本；当前未保存草稿已保留。比较后可选择载入新版本。
                      </span>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={discardReviewDraft}
                      >
                        放弃草稿并载入版本 {latestVersion.version_number}
                      </Button>
                    </div>
                  )}
                  {task.status === "reviewed" &&
                    latestVersion.origin === "lawyer_review" &&
                    latestTranscript.offsetUnit === "utf16" && (
                      <section
                        className="space-y-2 rounded-md border p-3"
                        aria-label="录音时间引用"
                      >
                        <div>
                          <h5 className="text-sm font-medium">
                            固定版本录音引用
                          </h5>
                          <p className="text-muted-foreground text-xs">
                            选择已复核原文中的文字，创建的引用固定绑定当前转写版本和原音频时间范围。
                          </p>
                        </div>
                        <textarea
                          aria-label="选择要引用的已复核转写文字"
                          readOnly
                          value={latestTranscript.text}
                          rows={Math.min(
                            8,
                            Math.max(
                              3,
                              Math.ceil(latestTranscript.text.length / 90),
                            ),
                          )}
                          onSelect={(event) => {
                            const input = event.currentTarget;
                            setCitationSelection(
                              input.selectionEnd > input.selectionStart
                                ? {
                                    start: input.selectionStart,
                                    end: input.selectionEnd,
                                  }
                                : null,
                            );
                          }}
                          className="bg-background w-full rounded-md border px-3 py-2 text-sm"
                        />
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={
                            !citationSelection || createSpeechCitation.isPending
                          }
                          onClick={() => void createCitation()}
                        >
                          {createSpeechCitation.isPending && (
                            <LoaderCircleIcon className="animate-spin" />
                          )}
                          创建所选文字的时间引用
                        </Button>
                        {speechCitations.data &&
                          speechCitations.data.length > 0 && (
                            <ul
                              className="space-y-1 text-xs"
                              aria-label="已创建的录音引用"
                            >
                              {speechCitations.data.map((citation) => (
                                <li
                                  key={citation.id}
                                  className="flex flex-wrap items-center gap-2"
                                >
                                  <button
                                    type="button"
                                    className="text-primary underline"
                                    onClick={() =>
                                      jumpToAudio(
                                        citation.audio_locator.start_ms,
                                      )
                                    }
                                    disabled={
                                      citation.source_state === "unavailable"
                                    }
                                  >
                                    {citation.quote_preview ?? "已保存引用"} ·{" "}
                                    {citation.audio_locator.start_ms}–
                                    {citation.audio_locator.end_ms} ms
                                  </button>
                                  <span className="text-muted-foreground">
                                    v
                                    {citation.transcript_version_id ===
                                    latestVersion.id
                                      ? latestVersion.version_number
                                      : "历史"}{" "}
                                    · {citation.lineage_state}
                                  </span>
                                </li>
                              ))}
                            </ul>
                          )}
                      </section>
                    )}
                  <div className="max-h-80 space-y-2 overflow-auto rounded-md border p-3">
                    {draftSegments.map((segment, index) => (
                      <div
                        key={`${segment.charStart}-${index}`}
                        className="grid gap-2 sm:grid-cols-[95px_1fr_150px]"
                      >
                        <button
                          type="button"
                          className="text-primary h-fit text-left text-xs underline"
                          onClick={() => {
                            jumpToAudio(segment.startMs);
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
                        <div className="grid grid-cols-2 gap-1">
                          <label className="text-muted-foreground text-[10px]">
                            起始 ms
                            <input
                              type="number"
                              min={0}
                              max={latestTranscript.durationMs}
                              value={segment.startMs}
                              disabled={
                                !canReview ||
                                !["awaiting_review", "reviewed"].includes(
                                  task.status,
                                )
                              }
                              aria-label={`校对片段 ${index + 1} 起始时间毫秒`}
                              onChange={(event) =>
                                changeSegment(index, {
                                  startMs: Math.max(
                                    0,
                                    Number(event.target.value) || 0,
                                  ),
                                })
                              }
                              className="bg-background w-full rounded border px-1 py-1 text-xs"
                            />
                          </label>
                          <label className="text-muted-foreground text-[10px]">
                            结束 ms
                            <input
                              type="number"
                              min={0}
                              max={latestTranscript.durationMs}
                              value={segment.endMs}
                              disabled={
                                !canReview ||
                                !["awaiting_review", "reviewed"].includes(
                                  task.status,
                                )
                              }
                              aria-label={`校对片段 ${index + 1} 结束时间毫秒`}
                              onChange={(event) =>
                                changeSegment(index, {
                                  endMs: Math.max(
                                    0,
                                    Number(event.target.value) || 0,
                                  ),
                                })
                              }
                              className="bg-background w-full rounded border px-1 py-1 text-xs"
                            />
                          </label>
                        </div>
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
                            onChange={(event) => {
                              draftDirtyRef.current = true;
                              setDraftSpeakers((current) =>
                                current.map((value) =>
                                  value.id === speaker.id
                                    ? { ...value, label: event.target.value }
                                    : value,
                                ),
                              );
                            }}
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
                  {canReview &&
                    ["awaiting_review", "reviewed"].includes(task.status) && (
                      <>
                        <label className="block space-y-1 text-sm">
                          <span>未分配到识别片段的尾部文字</span>
                          <textarea
                            value={trailingText}
                            onChange={(event) => {
                              draftDirtyRef.current = true;
                              setTrailingText(event.target.value);
                            }}
                            rows={2}
                            className="bg-background w-full rounded-md border px-3 py-2"
                          />
                        </label>
                        <fieldset className="space-y-2 rounded-md border p-3 text-sm">
                          <legend className="px-1 font-medium">
                            保存前复核确认
                          </legend>
                          <label className="flex items-start gap-2">
                            <input
                              type="checkbox"
                              checked={reviewedText}
                              onChange={(event) =>
                                setReviewedText(event.target.checked)
                              }
                            />
                            <span>我已逐段核对转写文字和匿名说话人标签。</span>
                          </label>
                          <label className="flex items-start gap-2">
                            <input
                              type="checkbox"
                              checked={reviewedTimeRanges}
                              onChange={(event) =>
                                setReviewedTimeRanges(event.target.checked)
                              }
                            />
                            <span>
                              我已对照原音频核对并修正每段时间范围；仅改文字不会清除时间估算提示。
                            </span>
                          </label>
                        </fieldset>
                      </>
                    )}
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
