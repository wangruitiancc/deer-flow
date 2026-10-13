import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import type { FullConfig, FullResult, Reporter, TestCase, TestResult } from "@playwright/test/reporter";

const plannedJourneys = [
  "platform-login",
  "owner-activation",
  "owner-login",
  "member-invitation-claim",
  "two-firm-eight-identities",
  "cross-firm-isolation",
  "lawyer-case-authorization",
  "finance-readonly-isolation",
  "finance-billing-readonly",
  "finance-case-denial",
  "finance-evidence-denial",
  "finance-speech-denial",
  "finance-thread-denial",
  "finance-tool-denial",
  "finance-rls-denial",
  "ownership-handoff",
  "member-suspend-restore",
  "password-reset-and-session-revocation",
  "keyboard-and-viewport-accessibility",
];

type Row = { journey: string; status: string; note: string };

export default class S7StatusReporter implements Reporter {
  private readonly outputFile?: string;
  private readonly rows = new Map<string, Row>();

  constructor(options: { outputFile?: string }) {
    this.outputFile = options.outputFile;
    for (const journey of plannedJourneys) {
      this.rows.set(journey, { journey, status: "not_run", note: "journey_not_yet_wired" });
    }
  }

  onBegin(_config: FullConfig): void {
    this.flush();
  }

  onTestEnd(test: TestCase, result: TestResult): void {
    const primaryJourney = /^S7\[(.+)\]/.exec(test.title)?.[1];
    const auxiliaryJourney = test.annotations.find((annotation) => annotation.type === "s7_journey")?.description;
    const stageStatus = result.annotations.find((annotation) => annotation.type === "s7_status");
    if (primaryJourney && this.rows.has(primaryJourney)) {
      const status = result.status === "passed" ? "passed" : result.status === "skipped" ? "not_run" : "failed";
      const [declaredStatus, ...declaredNote] = (stageStatus?.description ?? "").split(";");
      const normalizedDeclaredStatus = declaredStatus ?? "";
      const useDeclaredStatus = Boolean(!auxiliaryJourney && stageStatus && ["passed", "failed", "not_run", "blocked_external"].includes(normalizedDeclaredStatus));
      this.rows.set(primaryJourney, {
        journey: primaryJourney,
        status: useDeclaredStatus ? normalizedDeclaredStatus : status,
        note: useDeclaredStatus ? declaredNote.join(";") : status === "passed" ? "browser_journey_passed" : `playwright_${result.status}`,
      });
    }
    const journey = auxiliaryJourney ?? primaryJourney;
    if (!journey || !this.rows.has(journey) || journey === primaryJourney || !stageStatus) {
      this.flush();
      return;
    }
    const [status, ...note] = (stageStatus.description ?? "not_run;not_run_reason_unspecified").split(";");
    this.rows.set(journey, { journey, status: status ?? "not_run", note: note.join(";") });
    this.flush();
  }

  onEnd(_result: FullResult): void {
    this.flush();
  }

  private flush(): void {
    if (!this.outputFile) return;
    mkdirSync(dirname(this.outputFile), { recursive: true, mode: 0o700 });
    const contents = ["journey\tstatus\tnote", ...[...this.rows.values()].map((row) => `${row.journey}\t${row.status}\t${row.note}`)].join("\n") + "\n";
    writeFileSync(this.outputFile, contents, { mode: 0o600 });
  }
}
