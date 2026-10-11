import {
  LEGACY_SPEECH_CAPTURE_LIMITS,
  validateSpeechCaptureLimits,
} from "./speech-capture-limits";
import type {
  SpeechCaptureLimits,
  SpeechCaptureAudioTrackSettings,
} from "./types";

const DATABASE = "matrix-law-speech-capture-outbox-v1";
const VERSION = 3;
const ORIGIN_USAGE_KEY = "__same_origin__";
export const LOCAL_SPEECH_CAPTURE_STORAGE_UNAVAILABLE =
  "浏览器本机加密录音暂存无法打开；麦克风录音已关闭，未确认内容不会被当作已保存。请检查浏览器存储后重试。";

export function isLocalSpeechCaptureStorageUnavailable(
  error: unknown,
): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    error.message === LOCAL_SPEECH_CAPTURE_STORAGE_UNAVAILABLE
  );
}

export interface LocalSpeechCaptureSession {
  localId: string;
  idempotencyKey: string;
  captureId: string | null;
  tenantId: string;
  matterId: string;
  title: string;
  totalSamples: number;
  nextSequenceNumber: number;
  serverNextSequenceNumber: number;
  pendingBytes: number;
  lastSampleCount: number;
  limits?: SpeechCaptureLimits;
  audioTrackSettings: SpeechCaptureAudioTrackSettings | null;
  status: "creating" | "recording" | "interrupted" | "finalizing" | "completed";
  endReason: "user_stop" | "interrupted" | "limit_reached" | null;
  updatedAt: number;
}

export interface PendingSpeechPcmChunk {
  sequenceNumber: number;
  sampleCount: number;
  startSample: number;
  sha256: string;
  pcm: Uint8Array;
}

interface EncryptedRecord {
  key: string;
  scope: string;
  localId: string;
  iv: ArrayBuffer;
  ciphertext: ArrayBuffer;
}

interface EncryptedChunk extends EncryptedRecord {
  sequenceNumber: number;
  sampleCount: number;
  startSample: number;
  sha256: string;
  byteSize: number;
}

interface KeyRecord {
  scope: string;
  key: CryptoKey;
}

interface UsageRecord {
  scope: string;
  pendingBytes: number;
}

function captureBudgetLabel(bytes: number): string {
  return bytes % (1024 * 1024) === 0 ? `${bytes / (1024 * 1024)} MiB` : `${bytes} 字节`;
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error("IndexedDB request failed"));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () =>
      reject(transaction.error ?? new Error("IndexedDB transaction aborted"));
    transaction.onerror = () =>
      reject(transaction.error ?? new Error("IndexedDB transaction failed"));
  });
}

function openDatabase(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") {
    return Promise.reject(new Error(LOCAL_SPEECH_CAPTURE_STORAGE_UNAVAILABLE));
  }
  return new Promise((resolve, reject) => {
    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(DATABASE, VERSION);
    } catch {
      reject(new Error(LOCAL_SPEECH_CAPTURE_STORAGE_UNAVAILABLE));
      return;
    }
    request.onupgradeneeded = (event: IDBVersionChangeEvent) => {
      const database = request.result;
      if (!database.objectStoreNames.contains("sessions")) {
        database.createObjectStore("sessions", { keyPath: "key" });
      }
      const sessions = request.transaction?.objectStore("sessions");
      if (sessions && !sessions.indexNames.contains("byScope")) {
        sessions.createIndex("byScope", "scope", { unique: false });
      }
      if (!database.objectStoreNames.contains("chunks")) {
        const chunks = database.createObjectStore("chunks", { keyPath: "key" });
        chunks.createIndex("byScope", "scope", { unique: false });
        chunks.createIndex("bySession", ["scope", "localId"], {
          unique: false,
        });
      }
      if (!database.objectStoreNames.contains("keys")) {
        database.createObjectStore("keys", { keyPath: "scope" });
      }
      if (!database.objectStoreNames.contains("usage")) {
        database.createObjectStore("usage", { keyPath: "scope" });
      }
      if (event.oldVersion > 0 && event.oldVersion < 3) {
        const transaction = request.transaction;
        if (!transaction) throw new Error("无法迁移本机录音暂存配额。");
        const chunks = transaction.objectStore("chunks").getAll() as IDBRequest<
          EncryptedChunk[]
        >;
        chunks.onsuccess = () => {
          const pendingBytes = chunks.result.reduce(
            (total, chunk) => total + chunk.byteSize,
            0,
          );
          const usage = transaction.objectStore("usage");
          usage.clear();
          usage.put({
            scope: ORIGIN_USAGE_KEY,
            pendingBytes,
          } satisfies UsageRecord);
        };
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(new Error(LOCAL_SPEECH_CAPTURE_STORAGE_UNAVAILABLE));
    request.onblocked = () =>
      reject(new Error(LOCAL_SPEECH_CAPTURE_STORAGE_UNAVAILABLE));
  });
}

function sessionKey(scope: string, localId: string): string {
  return `${scope}:${localId}`;
}

const localSessionMutationTails = new Map<string, Promise<void>>();

async function withLocalSessionMutation<T>(
  scope: string,
  localId: string,
  operation: () => Promise<T>,
): Promise<T> {
  const key = sessionKey(scope, localId);
  const previous = localSessionMutationTails.get(key) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const tail = previous.then(() => gate);
  localSessionMutationTails.set(key, tail);
  await previous;
  try {
    return await operation();
  } finally {
    release();
    if (localSessionMutationTails.get(key) === tail)
      localSessionMutationTails.delete(key);
  }
}

async function readStoredSession(
  database: IDBDatabase,
  key: CryptoKey,
  scope: string,
  localId: string,
): Promise<LocalSpeechCaptureSession> {
  const transaction = database.transaction("sessions", "readonly");
  const done = transactionDone(transaction);
  const record = await requestResult(
    transaction
      .objectStore("sessions")
      .get(sessionKey(scope, localId)) as IDBRequest<
      EncryptedRecord | undefined
    >,
  );
  await done;
  if (!record) throw new Error("录音会话已取消，忽略迟到的本机更新。");
  return decryptJson<LocalSpeechCaptureSession>(key, record);
}

function chunkKey(
  scope: string,
  localId: string,
  sequenceNumber: number,
): string {
  return `${scope}:${localId}:${sequenceNumber.toString().padStart(8, "0")}`;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function aad(
  scope: string,
  captureId: string,
  sequenceNumber: number,
  sampleCount: number,
  startSample: number,
  sha256: string,
): ArrayBuffer {
  return toArrayBuffer(
    new TextEncoder().encode(
      `${scope}|${captureId}|${sequenceNumber}|${sampleCount}|${startSample}|${sha256}`,
    ),
  );
}

export async function localSpeechIdentityScope(
  userId: string,
  membershipId: string,
): Promise<string> {
  const bytes = new TextEncoder().encode(`${userId}\u0000${membershipId}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

async function loadKey(
  database: IDBDatabase,
  scope: string,
): Promise<CryptoKey> {
  const transaction = database.transaction("keys", "readonly");
  const done = transactionDone(transaction);
  const record = await requestResult(
    transaction.objectStore("keys").get(scope) as IDBRequest<
      KeyRecord | undefined
    >,
  );
  await done;
  if (record?.key) return record.key;

  const generated = await crypto.subtle.generateKey(
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
  const write = database.transaction("keys", "readwrite");
  const writeDone = transactionDone(write);
  const store = write.objectStore("keys");
  const existingRequest = store.get(scope) as IDBRequest<KeyRecord | undefined>;
  const key = await new Promise<CryptoKey>((resolve, reject) => {
    existingRequest.onsuccess = () => {
      const existing = existingRequest.result;
      if (existing?.key) {
        resolve(existing.key);
        return;
      }
      store.put({ scope, key: generated } satisfies KeyRecord);
      resolve(generated);
    };
    existingRequest.onerror = () =>
      reject(existingRequest.error ?? new Error("无法读取本机加密密钥。"));
  });
  await writeDone;
  return key;
}

async function readExistingKey(
  database: IDBDatabase,
  scope: string,
): Promise<CryptoKey | null> {
  const transaction = database.transaction("keys", "readonly");
  const done = transactionDone(transaction);
  const record = await requestResult(
    transaction.objectStore("keys").get(scope) as IDBRequest<
      KeyRecord | undefined
    >,
  );
  await done;
  return record?.key ?? null;
}

async function encryptJson(
  key: CryptoKey,
  value: unknown,
): Promise<{ iv: ArrayBuffer; ciphertext: ArrayBuffer }> {
  const iv = toArrayBuffer(crypto.getRandomValues(new Uint8Array(12)));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    toArrayBuffer(new TextEncoder().encode(JSON.stringify(value))),
  );
  return { iv, ciphertext };
}

const LOCAL_CAPTURE_INTEGRITY_ERROR =
  "本机录音加密暂存无法解密或完整性校验失败；已暂停补传，暂存未自动删除。请联系管理员处理。";

function localCaptureIntegrityError(): Error {
  return new Error(LOCAL_CAPTURE_INTEGRITY_ERROR);
}

async function decryptJson<T>(
  key: CryptoKey,
  record: EncryptedRecord,
): Promise<T> {
  try {
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: record.iv },
      key,
      record.ciphertext,
    );
    return JSON.parse(new TextDecoder().decode(plaintext)) as T;
  } catch {
    throw localCaptureIntegrityError();
  }
}

export function speechCaptureStorageAvailable(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof indexedDB !== "undefined" &&
    typeof crypto !== "undefined" &&
    !!crypto.subtle &&
    typeof navigator !== "undefined" &&
    !!navigator.locks?.request
  );
}

export async function verifySpeechCaptureStorage(): Promise<void> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(
      ["sessions", "chunks", "keys", "usage"],
      "readonly",
    );
    await transactionDone(transaction);
  } catch {
    throw new Error(LOCAL_SPEECH_CAPTURE_STORAGE_UNAVAILABLE);
  } finally {
    database.close();
  }
}

export async function acquireSpeechCaptureLock(
  scope: string,
  lockId: string,
): Promise<(() => void) | null> {
  if (!navigator.locks?.request)
    throw new Error("当前浏览器不支持录音恢复锁。");
  let resolveAcquired!: (release: (() => void) | null) => void;
  let rejectAcquired!: (error: unknown) => void;
  let settled = false;
  const acquired = new Promise<(() => void) | null>((resolve, reject) => {
    resolveAcquired = resolve;
    rejectAcquired = reject;
  });
  let releaseHold!: () => void;
  const held = new Promise<void>((resolve) => {
    releaseHold = resolve;
  });
  const request = navigator.locks.request(
    `matrix-law-speech:${scope}:${lockId}`,
    { mode: "exclusive", ifAvailable: true },
    async (lock) => {
      if (!lock) {
        settled = true;
        resolveAcquired(null);
        return;
      }
      let released = false;
      const release = () => {
        if (released) return;
        released = true;
        releaseHold();
      };
      settled = true;
      resolveAcquired(release);
      await held;
    },
  );
  void request.catch((error: unknown) => {
    if (settled) return;
    settled = true;
    rejectAcquired(error);
  });
  return acquired;
}

export async function createLocalSpeechCapture(
  userId: string,
  membershipId: string,
  input: Omit<
    LocalSpeechCaptureSession,
    | "localId"
    | "idempotencyKey"
    | "captureId"
    | "totalSamples"
    | "nextSequenceNumber"
    | "serverNextSequenceNumber"
    | "pendingBytes"
    | "lastSampleCount"
    | "status"
    | "endReason"
    | "updatedAt"
  >,
): Promise<{ scope: string; session: LocalSpeechCaptureSession }> {
  const scope = await localSpeechIdentityScope(userId, membershipId);
  const database = await openDatabase();
  try {
    const key = await loadKey(database, scope);
    const session: LocalSpeechCaptureSession = {
      ...input,
      localId: crypto.randomUUID(),
      idempotencyKey: crypto.randomUUID(),
      captureId: null,
      totalSamples: 0,
      nextSequenceNumber: 0,
      serverNextSequenceNumber: 0,
      pendingBytes: 0,
      lastSampleCount: 0,
      audioTrackSettings: input.audioTrackSettings,
      status: "creating",
      endReason: null,
      updatedAt: Date.now(),
    };
    const encrypted = await encryptJson(key, session);
    const transaction = database.transaction(
      ["sessions", "usage"],
      "readwrite",
    );
    const done = transactionDone(transaction);
    transaction.objectStore("sessions").put({
      key: sessionKey(scope, session.localId),
      scope,
      localId: session.localId,
      ...encrypted,
    } satisfies EncryptedRecord);
    const usageStore = transaction.objectStore("usage");
    const usageRequest = usageStore.get(ORIGIN_USAGE_KEY) as IDBRequest<
      UsageRecord | undefined
    >;
    usageRequest.onsuccess = () => {
      if (!usageRequest.result)
        usageStore.put({
          scope: ORIGIN_USAGE_KEY,
          pendingBytes: 0,
        } satisfies UsageRecord);
    };
    await done;
    return { scope, session };
  } finally {
    database.close();
  }
}

export async function adoptServerSpeechCapture(
  userId: string,
  membershipId: string,
  input: {
    tenantId: string;
    matterId: string;
    captureId: string;
    title: string;
    totalSamples: number;
    nextSequenceNumber: number;
    limits?: SpeechCaptureLimits;
    audioTrackSettings?: SpeechCaptureAudioTrackSettings | null;
  },
): Promise<{ scope: string; session: LocalSpeechCaptureSession }> {
  const created = await createLocalSpeechCapture(userId, membershipId, {
    tenantId: input.tenantId,
    matterId: input.matterId,
    title: input.title,
    audioTrackSettings: input.audioTrackSettings ?? null,
  });
  const session: LocalSpeechCaptureSession = {
    ...created.session,
    captureId: input.captureId,
    limits: input.limits,
    totalSamples: input.totalSamples,
    nextSequenceNumber: input.nextSequenceNumber,
    serverNextSequenceNumber: input.nextSequenceNumber,
    pendingBytes: 0,
    lastSampleCount: 0,
    status: "interrupted",
    endReason: "interrupted",
  };
  await updateLocalSpeechCapture(created.scope, session);
  return { scope: created.scope, session };
}

export async function updateLocalSpeechCapture(
  scope: string,
  session: LocalSpeechCaptureSession,
): Promise<void> {
  return withLocalSessionMutation(scope, session.localId, async () => {
    const database = await openDatabase();
    try {
      const key = await readExistingKey(database, scope);
      if (!key) throw new Error("录音身份缓存已清理，忽略迟到的本机更新。");
      const current = await readStoredSession(
        database,
        key,
        scope,
        session.localId,
      );
      const updated: LocalSpeechCaptureSession = {
        ...current,
        ...session,
        captureId: session.captureId ?? current.captureId,
        totalSamples: Math.max(current.totalSamples, session.totalSamples),
        nextSequenceNumber: Math.max(
          current.nextSequenceNumber,
          session.nextSequenceNumber,
        ),
        serverNextSequenceNumber: Math.max(
          current.serverNextSequenceNumber,
          session.serverNextSequenceNumber,
        ),
        pendingBytes: current.pendingBytes,
        lastSampleCount:
          session.totalSamples > current.totalSamples
            ? session.lastSampleCount
            : current.lastSampleCount,
        updatedAt: Date.now(),
      };
      const encrypted = await encryptJson(key, updated);
      const transaction = database.transaction("sessions", "readwrite");
      const done = transactionDone(transaction);
      const store = transaction.objectStore("sessions");
      const existingRequest = store.get(
        sessionKey(scope, session.localId),
      ) as IDBRequest<EncryptedRecord | undefined>;
      let missingSession = false;
      existingRequest.onsuccess = () => {
        if (!existingRequest.result) {
          missingSession = true;
          transaction.abort();
          return;
        }
        store.put({
          key: sessionKey(scope, session.localId),
          scope,
          localId: session.localId,
          ...encrypted,
        } satisfies EncryptedRecord);
      };
      try {
        await done;
      } catch (error) {
        if (missingSession)
          throw new Error("录音会话已取消，忽略迟到的本机更新。");
        throw error;
      }
    } finally {
      database.close();
    }
  });
}

export async function listLocalSpeechCaptures(
  userId: string,
  membershipId: string,
): Promise<{ scope: string; sessions: LocalSpeechCaptureSession[] }> {
  const scope = await localSpeechIdentityScope(userId, membershipId);
  const database = await openDatabase();
  try {
    const key = await readExistingKey(database, scope);
    const transaction = database.transaction("sessions", "readonly");
    const done = transactionDone(transaction);
    const records = await requestResult(
      transaction
        .objectStore("sessions")
        .index("byScope")
        .getAll(scope) as IDBRequest<EncryptedRecord[]>,
    );
    await done;
    if (!key) {
      if (records.length > 0) throw localCaptureIntegrityError();
      return { scope, sessions: [] };
    }
    const sessions: LocalSpeechCaptureSession[] = [];
    for (const record of records)
      sessions.push(await decryptJson<LocalSpeechCaptureSession>(key, record));
    return { scope, sessions };
  } finally {
    database.close();
  }
}

export async function getLocalSpeechCapture(
  scope: string,
  localId: string,
): Promise<LocalSpeechCaptureSession | null> {
  const database = await openDatabase();
  try {
    const key = await readExistingKey(database, scope);
    const transaction = database.transaction("sessions", "readonly");
    const done = transactionDone(transaction);
    const record = await requestResult(
      transaction
        .objectStore("sessions")
        .get(sessionKey(scope, localId)) as IDBRequest<
        EncryptedRecord | undefined
      >,
    );
    await done;
    if (!record) return null;
    if (!key) throw localCaptureIntegrityError();
    return await decryptJson<LocalSpeechCaptureSession>(key, record);
  } finally {
    database.close();
  }
}

export function localSpeechCapturesForMatter(
  sessions: LocalSpeechCaptureSession[],
  tenantId: string,
  matterId: string,
): LocalSpeechCaptureSession[] {
  return sessions.filter(
    (session) => session.tenantId === tenantId && session.matterId === matterId,
  );
}

export async function clearLocalSpeechMatter(
  userId: string,
  membershipId: string,
  tenantId: string,
  matterId: string,
): Promise<void> {
  const { scope, sessions } = await listLocalSpeechCaptures(
    userId,
    membershipId,
  );
  const selected = localSpeechCapturesForMatter(sessions, tenantId, matterId);
  await Promise.all(
    selected.map((session) => deleteLocalSpeechCapture(scope, session.localId)),
  );
}

export async function persistSpeechPcmChunk(
  scope: string,
  session: LocalSpeechCaptureSession,
  pcm: Uint8Array,
): Promise<{
  session: LocalSpeechCaptureSession;
  chunk: PendingSpeechPcmChunk;
}> {
  if (
    pcm.byteLength === 0 ||
    pcm.byteLength % 2 !== 0 ||
    pcm.byteLength > 32_000
  ) {
    throw new Error("PCM 分片长度无效。");
  }
  const sampleCount = pcm.byteLength / 2;
  if (sampleCount > 16_000) throw new Error("PCM 尾片只能是录音的最后一片。");
  const sha = await crypto.subtle.digest("SHA-256", toArrayBuffer(pcm));
  const sha256 = Array.from(new Uint8Array(sha), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  return withLocalSessionMutation(scope, session.localId, async () => {
    const database = await openDatabase();
    try {
      const key = await readExistingKey(database, scope);
      if (!key) throw new Error("录音身份缓存已清理，忽略迟到的本机分片。");
      const current = await readStoredSession(
        database,
        key,
        scope,
        session.localId,
      );
      if (!current.captureId) throw new Error("录音会话尚未由服务器确认。");
      if (session.captureId && session.captureId !== current.captureId)
        throw new Error("本机录音会话与当前服务器会话不匹配。");
      if (current.lastSampleCount > 0 && current.lastSampleCount < 16_000) {
        throw new Error("PCM 尾片只能是录音的最后一片。");
      }
      const limits = current.limits
        ? validateSpeechCaptureLimits(current.limits)
        : LEGACY_SPEECH_CAPTURE_LIMITS;
      if (current.totalSamples + sampleCount > limits.max_samples)
        throw new Error("录音达到服务器时长或文件大小限制，已停止采集。");
      const newPendingBytes = current.pendingBytes + pcm.byteLength;
      if (newPendingBytes > limits.max_pending_bytes_per_session)
        throw new Error(`本机会话暂存达到 ${captureBudgetLabel(limits.max_pending_bytes_per_session)} 上限，录音已停止。`);
      const sequenceNumber = current.nextSequenceNumber;
      const startSample = current.totalSamples;
      const updated: LocalSpeechCaptureSession = {
        ...current,
        totalSamples: current.totalSamples + sampleCount,
        nextSequenceNumber: sequenceNumber + 1,
        pendingBytes: newPendingBytes,
        lastSampleCount: sampleCount,
        status: "recording",
        updatedAt: Date.now(),
      };
      const iv = toArrayBuffer(crypto.getRandomValues(new Uint8Array(12)));
      const ciphertext = await crypto.subtle.encrypt(
        {
          name: "AES-GCM",
          iv,
          additionalData: aad(
            scope,
            current.captureId,
            sequenceNumber,
            sampleCount,
            startSample,
            sha256,
          ),
        },
        key,
        toArrayBuffer(pcm),
      );
      const encryptedSession = await encryptJson(key, updated);
      const transaction = database.transaction(
        ["chunks", "sessions", "usage"],
        "readwrite",
      );
      const done = transactionDone(transaction);
      const usageStore = transaction.objectStore("usage");
      const sessionStore = transaction.objectStore("sessions");
      const existingSession = sessionStore.get(
        sessionKey(scope, session.localId),
      ) as IDBRequest<EncryptedRecord | undefined>;
      let capacityFailure = false;
      let missingSession = false;
      existingSession.onsuccess = () => {
        if (!existingSession.result) {
          missingSession = true;
          transaction.abort();
          return;
        }
        const usageRequest = usageStore.get(ORIGIN_USAGE_KEY) as IDBRequest<
          UsageRecord | undefined
        >;
        usageRequest.onsuccess = () => {
          const pending = usageRequest.result?.pendingBytes ?? 0;
          if (pending + pcm.byteLength > limits.max_pending_bytes_per_origin) {
            capacityFailure = true;
            transaction.abort();
            return;
          }
          usageStore.put({
            scope: ORIGIN_USAGE_KEY,
            pendingBytes: pending + pcm.byteLength,
          } satisfies UsageRecord);
          transaction.objectStore("chunks").put({
            key: chunkKey(scope, session.localId, sequenceNumber),
            scope,
            localId: session.localId,
            sequenceNumber,
            sampleCount,
            startSample,
            sha256,
            byteSize: pcm.byteLength,
            iv,
            ciphertext,
          } satisfies EncryptedChunk);
          sessionStore.put({
            key: sessionKey(scope, session.localId),
            scope,
            localId: session.localId,
            ...encryptedSession,
          } satisfies EncryptedRecord);
        };
      };
      try {
        await done;
      } catch (error) {
        if (capacityFailure)
          throw new Error(`本机同源录音暂存达到 ${captureBudgetLabel(limits.max_pending_bytes_per_origin)} 上限，录音已停止。`);
        if (missingSession)
          throw new Error("录音会话已取消，忽略迟到的本机分片。");
        throw error;
      }
      return {
        session: updated,
        chunk: { sequenceNumber, sampleCount, startSample, sha256, pcm },
      };
    } finally {
      database.close();
    }
  });
}

export async function readPendingSpeechPcmChunks(
  scope: string,
  session: LocalSpeechCaptureSession,
): Promise<PendingSpeechPcmChunk[]> {
  if (!session.captureId) return [];
  const database = await openDatabase();
  try {
    const key = await readExistingKey(database, scope);
    if (!key) throw localCaptureIntegrityError();
    const transaction = database.transaction("chunks", "readonly");
    const done = transactionDone(transaction);
    const all = await requestResult(
      transaction.objectStore("chunks").getAll() as IDBRequest<
        EncryptedChunk[]
      >,
    );
    await done;
    const selected = all
      .filter(
        (record) =>
          record.scope === scope && record.localId === session.localId,
      )
      .sort((left, right) => left.sequenceNumber - right.sequenceNumber);
    const chunks: PendingSpeechPcmChunk[] = [];
    for (const record of selected) {
      let plaintext: ArrayBuffer;
      try {
        plaintext = await crypto.subtle.decrypt(
          {
            name: "AES-GCM",
            iv: record.iv,
            additionalData: aad(
              scope,
              session.captureId,
              record.sequenceNumber,
              record.sampleCount,
              record.startSample,
              record.sha256,
            ),
          },
          key,
          record.ciphertext,
        );
      } catch {
        throw localCaptureIntegrityError();
      }
      const pcm = new Uint8Array(plaintext);
      const digest = await crypto.subtle.digest("SHA-256", toArrayBuffer(pcm));
      const actual = Array.from(new Uint8Array(digest), (byte) =>
        byte.toString(16).padStart(2, "0"),
      ).join("");
      if (
        actual !== record.sha256 ||
        pcm.byteLength !== record.byteSize ||
        pcm.byteLength !== record.sampleCount * 2
      ) {
        throw localCaptureIntegrityError();
      }
      chunks.push({
        sequenceNumber: record.sequenceNumber,
        sampleCount: record.sampleCount,
        startSample: record.startSample,
        sha256: record.sha256,
        pcm,
      });
    }
    return chunks;
  } finally {
    database.close();
  }
}

export async function acknowledgeSpeechPcmChunk(
  scope: string,
  session: LocalSpeechCaptureSession,
  chunk: PendingSpeechPcmChunk,
  serverNextSequenceNumber: number,
): Promise<LocalSpeechCaptureSession> {
  return withLocalSessionMutation(scope, session.localId, async () => {
    const database = await openDatabase();
    try {
      const key = await readExistingKey(database, scope);
      if (!key) throw new Error("录音身份缓存已清理，忽略迟到的分片回执。");
      const current = await readStoredSession(
        database,
        key,
        scope,
        session.localId,
      );
      const chunkTransaction = database.transaction("chunks", "readonly");
      const chunkDone = transactionDone(chunkTransaction);
      const storedChunk = await requestResult(
        chunkTransaction
          .objectStore("chunks")
          .get(
            chunkKey(scope, session.localId, chunk.sequenceNumber),
          ) as IDBRequest<EncryptedChunk | undefined>,
      );
      await chunkDone;
      if (storedChunk && storedChunk.sha256 !== chunk.sha256)
        throw new Error("服务器回执与本机分片摘要不一致。");
      const updated: LocalSpeechCaptureSession = {
        ...current,
        serverNextSequenceNumber: Math.max(
          current.serverNextSequenceNumber,
          serverNextSequenceNumber,
        ),
        pendingBytes: Math.max(
          0,
          current.pendingBytes - (storedChunk?.byteSize ?? 0),
        ),
        updatedAt: Date.now(),
      };
      const encryptedSession = await encryptJson(key, updated);
      const transaction = database.transaction(
        ["chunks", "sessions", "usage"],
        "readwrite",
      );
      const done = transactionDone(transaction);
      const chunks = transaction.objectStore("chunks");
      const sessionStore = transaction.objectStore("sessions");
      const stored = await requestResult(
        chunks.get(
          chunkKey(scope, session.localId, chunk.sequenceNumber),
        ) as IDBRequest<EncryptedChunk | undefined>,
      );
      if (stored && stored.sha256 !== chunk.sha256) {
        transaction.abort();
        await done.catch(() => undefined);
        throw new Error("服务器回执与本机分片摘要不一致。");
      }
      const storedSession = await requestResult(
        sessionStore.get(sessionKey(scope, session.localId)) as IDBRequest<
          EncryptedRecord | undefined
        >,
      );
      if (!storedSession) {
        transaction.abort();
        await done.catch(() => undefined);
        throw new Error("录音会话已取消，忽略迟到的分片回执。");
      }
      if (stored) {
        chunks.delete(stored.key);
        const usageStore = transaction.objectStore("usage");
        const usage = await requestResult(
          usageStore.get(ORIGIN_USAGE_KEY) as IDBRequest<
            UsageRecord | undefined
          >,
        );
        usageStore.put({
          scope: ORIGIN_USAGE_KEY,
          pendingBytes: Math.max(
            0,
            (usage?.pendingBytes ?? 0) - stored.byteSize,
          ),
        } satisfies UsageRecord);
      }
      sessionStore.put({
        key: sessionKey(scope, session.localId),
        scope,
        localId: session.localId,
        ...encryptedSession,
      } satisfies EncryptedRecord);
      await done;
      return updated;
    } finally {
      database.close();
    }
  });
}

export async function deleteLocalSpeechCapture(
  scope: string,
  localId: string,
): Promise<void> {
  return withLocalSessionMutation(scope, localId, async () => {
    const database = await openDatabase();
    try {
      const transaction = database.transaction(
        ["chunks", "sessions", "usage"],
        "readwrite",
      );
      const done = transactionDone(transaction);
      const chunkStore = transaction.objectStore("chunks");
      const all = await requestResult(
        chunkStore.getAll() as IDBRequest<EncryptedChunk[]>,
      );
      const selected = all.filter(
        (record) => record.scope === scope && record.localId === localId,
      );
      const usageStore = transaction.objectStore("usage");
      const usage = await requestResult(
        usageStore.get(ORIGIN_USAGE_KEY) as IDBRequest<UsageRecord | undefined>,
      );
      for (const record of selected) chunkStore.delete(record.key);
      usageStore.put({
        scope: ORIGIN_USAGE_KEY,
        pendingBytes: Math.max(
          0,
          (usage?.pendingBytes ?? 0) -
            selected.reduce((total, row) => total + row.byteSize, 0),
        ),
      } satisfies UsageRecord);
      transaction.objectStore("sessions").delete(sessionKey(scope, localId));
      await done;
    } finally {
      database.close();
    }
  });
}

export async function clearLocalSpeechIdentity(
  userId: string,
  membershipId: string,
): Promise<void> {
  const scope = await localSpeechIdentityScope(userId, membershipId);
  const database = await openDatabase();
  try {
    const transaction = database.transaction(
      ["chunks", "sessions", "keys", "usage"],
      "readwrite",
    );
    const done = transactionDone(transaction);
    const chunkStore = transaction.objectStore("chunks");
    const chunks = await requestResult(
      chunkStore.getAll() as IDBRequest<EncryptedChunk[]>,
    );
    const scopedChunks = chunks.filter((record) => record.scope === scope);
    for (const record of scopedChunks) chunkStore.delete(record.key);
    const sessionStore = transaction.objectStore("sessions");
    const sessions = await requestResult(
      sessionStore.getAll() as IDBRequest<EncryptedRecord[]>,
    );
    for (const record of sessions)
      if (record.scope === scope) sessionStore.delete(record.key);
    transaction.objectStore("keys").delete(scope);
    const usageStore = transaction.objectStore("usage");
    const usage = await requestResult(
      usageStore.get(ORIGIN_USAGE_KEY) as IDBRequest<UsageRecord | undefined>,
    );
    usageStore.put({
      scope: ORIGIN_USAGE_KEY,
      pendingBytes: Math.max(
        0,
        (usage?.pendingBytes ?? 0) -
          scopedChunks.reduce((total, row) => total + row.byteSize, 0),
      ),
    } satisfies UsageRecord);
    await done;
  } finally {
    database.close();
  }
}
