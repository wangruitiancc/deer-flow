import { describe, expect, it } from "@rstest/core";

import {
  localSpeechCapturesForMatter,
  type LocalSpeechCaptureSession,
} from "@/core/law/speech-capture-outbox";

function session(
  localId: string,
  tenantId: string,
  matterId: string,
): LocalSpeechCaptureSession {
  return { localId, tenantId, matterId } as LocalSpeechCaptureSession;
}

describe("local speech capture matter scoping", () => {
  it("selects only the revoked tenant and matter while preserving other matter caches", () => {
    const sessions = [
      session("current", "tenant-1", "matter-1"),
      session("other-matter", "tenant-1", "matter-2"),
      session("other-tenant", "tenant-2", "matter-1"),
    ];

    expect(
      localSpeechCapturesForMatter(sessions, "tenant-1", "matter-1").map(
        (item) => item.localId,
      ),
    ).toEqual(["current"]);
  });
});
