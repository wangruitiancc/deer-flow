import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";

import { expect, test } from "@playwright/test";

import { installSpeechPreviewTimingProbe } from "../helpers/speech-preview-timing-probe";

let server: Server;
let origin: string;
let workletSha: string;
test.beforeAll(async () => {
  const worklet = await readFile("public/worklets/pcm16-capture.js");
  workletSha = createHash("sha256").update(worklet).digest("hex");
  server = createServer((request, response) => {
    if (request.url === "/worklets/pcm16-capture.js") {
      response.writeHead(200, { "Content-Type": "application/javascript" });
      response.end(worklet);
      return;
    }
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    response.end(
      "<!doctype html><title>Synthetic speech timing probe</title><main></main>",
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("fixture_listener_unavailable");
  origin = `http://127.0.0.1:${address.port}`;
});
test.afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
});

test("real Worklet timing includes delayed main-thread delivery and exports only numeric evidence", async ({
  page,
}) => {
  const initializationErrors: string[] = [];
  page.on("pageerror", (error) => initializationErrors.push(error.message));
  await page.addInitScript(installSpeechPreviewTimingProbe);
  await page.goto(origin);
  expect(initializationErrors).toEqual([]);
  await page.evaluate(async () => {
    const context = new AudioContext({ sampleRate: 16000 });
    await context.audioWorklet.addModule("/worklets/pcm16-capture.js");
    const source = context.createOscillator();
    source.frequency.value = 440;
    const node = new AudioWorkletNode(context, "matrix-law-pcm16-capture", {
      numberOfInputs: 1,
      numberOfOutputs: 0,
      channelCount: 1,
      processorOptions: { maxSamples: 160000 },
    });
    const root = document.createElement("div");
    root.setAttribute("aria-label", "录音临时识别预览");
    document.body.append(root);
    let samples = 0;
    node.port.onmessage = (
      event: MessageEvent<{ type: string; samples?: ArrayBuffer }>,
    ) => {
      if (event.data.type === "pcm") {
        samples += event.data.samples!.byteLength / 2;
        if (samples % 80000 === 0) {
          const end = samples / 16000;
          setTimeout(() => {
            const row = document.createElement("div");
            const label = document.createElement("span");
            label.textContent = `${end - 5}–${end} 秒`;
            row.append(label, document.createTextNode("SYNTHETIC_TIMING_ONLY"));
            root.append(row);
          }, 300);
        }
      } else if (event.data.type === "limit_reached") {
        node.port.postMessage({ type: "flush" });
        source.stop();
      } else if (event.data.type === "flushed") {
        void context.close();
      }
    };
    source.connect(node);
    source.start();
    await context.resume();
    // Intentionally delay the first window's MessagePort delivery. The audio
    // thread keeps sampling; a delivery-based timer would miss this interval.
    setTimeout(() => {
      const until = performance.now() + 600;
      while (performance.now() < until) {
        /* synthetic main-thread stall */
      }
    }, 4800);
  });
  await expect
    .poll(
      async () =>
        page.evaluate(
          () =>
            (
              window as typeof window & {
                __w11SpeechTimingProbe: { snapshot: () => { state: string } };
              }
            ).__w11SpeechTimingProbe.snapshot().state,
        ),
      { timeout: 20_000 },
    )
    .toBe("complete");
  const report = await page.evaluate(() =>
    (
      window as typeof window & {
        __w11SpeechTimingProbe: {
          snapshot: () => {
            sampled_samples: number;
            windows: {
              main_thread_delivery_ms: number;
              sample_end_estimate_ms: number;
              latency_ms: number;
            }[];
            target_met: boolean | null;
          };
        };
      }
    ).__w11SpeechTimingProbe.snapshot(),
  );
  expect(report.sampled_samples).toBe(160000);
  expect(report.windows).toHaveLength(2);
  expect(report.target_met).toBeNull();
  expect(
    report.windows[0]!.main_thread_delivery_ms -
      report.windows[0]!.sample_end_estimate_ms,
  ).toBeGreaterThan(200);
  expect(report.windows[0]!.latency_ms).toBeGreaterThan(600);
  expect(report.windows[1]!.latency_ms).toBeGreaterThanOrEqual(300);
  expect(JSON.stringify(report)).not.toContain("SYNTHETIC_TIMING_ONLY");
  if (process.env.W11_TIMING_PROBE_EVIDENCE_FILE)
    await writeFile(
      process.env.W11_TIMING_PROBE_EVIDENCE_FILE,
      JSON.stringify(
        {
          scope:
            "local synthetic oscillator and deliberately delayed DOM; not target ASR/T44",
          worklet_sha256: workletSha,
          report,
        },
        null,
        2,
      ) + "\n",
    );
});
