# W11 preview timing probe

`speech-preview-timing-probe.ts` is test-only instrumentation. Application code
must never import it. Use it only in a coordinated synthetic-audio acceptance
journey; it neither enables the microphone nor creates/changes a capture.

Install `installSpeechPreviewTimingProbe` with `page.addInitScript` before app
JavaScript. The probe observes only the existing PCM worklet's byte length and
numeric `endFrame`, then the preview's time labels. It does not copy audio, read
transcript-containing elements, intercept requests, or record headers/cookies.
Read `window.__w11SpeechTimingProbe.snapshot()` for a bounded numeric report and
call `dispose()` afterward. Keep the preview visible. A hidden page, a second
capture, malformed metadata, or an unavailable clock invalidates the run.

The required Worklet has SHA-256
`f681fb0594abd8a8c1128955381b86b570d5569aa1e69ef3c2b465a0d5026da1`.
Older G/J Worklets lack `endFrame` and deliberately cannot produce valid timing
evidence. The extra MessagePort field never enters the raw PCM upload.

`endFrame` is the exclusive frame following the final sampled input. Calibrate
it against running `AudioContext.currentTime` and `performance.now()` when the
message arrives; subtract one 128-frame/8ms rendering quantum conservatively.
Wait for two animation frames and check visible time-label geometry before
recording display. This is a browser frame-clock/visibility estimate, not an
acoustic device timestamp or proof that a physical screen was photographed.
It includes main-thread delivery delay rather than starting the clock at receipt.
The method follows the W3C definitions of [currentTime](https://www.w3.org/TR/webaudio-1.0/#dom-baseaudiocontext-currenttime)
and [currentFrame](https://www.w3.org/TR/webaudio-1.0/#dom-audioworkletglobalscope-currentframe).

The report includes the first cold window, pending complete windows and a
nearest-rank P95. It emits no passing result for missing windows, an unfinished
capture, or fewer than 20 complete windows. A short final tail is not a full
five-second window. Keep the 5,000ms target unchanged. A cancelled preview window
is not silently dropped from the denominator.

Local harness self-check:

```bash
python3 ../scripts/pnpm.py exec rstest run \
  tests/unit/core/law/speech-capture-worklet.test.ts \
  tests/unit/core/law/speech-preview-timing-probe.dom.test.ts
python3 ../scripts/pnpm.py exec playwright test \
  -c playwright.speech-timing.config.ts
```

The browser self-check serves the actual Worklet on an ephemeral loopback port,
uses an oscillator, stalls the main thread for600ms and delays a synthetic DOM
label by300ms. Its output is **not target ASR/T44 performance**. Optional
`W11_TIMING_PROBE_EVIDENCE_FILE` writes numeric results only. There is no auth,
database, model, real microphone, screenshot, video or trace in this check.

For target acceptance, retain real authentication and business APIs; do not use
the synthetic DOM test as the application. Use the approved exact600-second
input, correlate the capture with the final task's actual queue events and
`tests/deploy/native_speech_queue_telemetry.py` in the paired Law repository.
Check active release, model/fixture digests, complete window counts, source
integrity and formal completion before interpreting P95. Abort the synthetic
journey on a resource collector abort or release change. Do not enable tracing,
HAR, authentication persistence, page-body logging or automatic screenshots on
the real-service journey. Target publication must include this Worklet first;
the already completed physical-microphone acceptance does not need repetition.
