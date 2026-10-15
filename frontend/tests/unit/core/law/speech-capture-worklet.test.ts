import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";

import { describe, expect, it } from "@rstest/core";

function worklet(maxSamples: number) {
  type Message = { type: string; samples?: ArrayBuffer; endFrame?: number };
  type Processor = {
    process(inputs: Float32Array[][]): boolean;
    port: { onmessage: (event: { data: { type: string } }) => void };
  };
  let Constructor!: new (options: object) => Processor;
  const messages: Message[] = [];
  const scope = {
    currentFrame: 0,
    AudioWorkletProcessor: class {
      port = {
        postMessage: (message: Message) => messages.push(message),
        onmessage: () => undefined,
      };
    },
    registerProcessor: (_name: string, type: typeof Constructor) => {
      Constructor = type;
    },
  };
  runInNewContext(
    readFileSync(resolve("public/worklets/pcm16-capture.js"), "utf8"),
    scope,
  );
  return {
    processor: new Constructor({ processorOptions: { maxSamples } }),
    messages,
    setFrame: (frame: number) => {
      scope.currentFrame = frame;
    },
  };
}

describe("PCM worklet sample budget", () => {
  it("timestamps a full chunk at its actual exclusive sample frame across render blocks", () => {
    const { processor, messages, setFrame } = worklet(32000);
    setFrame(1000);
    processor.process([[new Float32Array(15999).fill(0.5)]]);
    setFrame(16999);
    processor.process([[new Float32Array([1])]]);
    expect(messages[0]?.endFrame).toBe(17000);
    expect(messages[0]?.samples?.byteLength).toBe(32000);
  });
  it("retains the final sampled frame when a delayed flush arrives, without changing PCM bytes", () => {
    const { processor, messages, setFrame } = worklet(32000);
    setFrame(1000);
    processor.process([[new Float32Array([-2, -1, -0.5, 0, 0.5, 1, 2])]]);
    setFrame(9000);
    processor.port.onmessage({ data: { type: "flush" } });
    expect(messages[0]?.endFrame).toBe(1007);
    expect(Array.from(new Int16Array(messages[0]!.samples!))).toEqual([
      -32768, -32768, -16384, 0, 16383, 32767, 32767,
    ]);
    expect(messages.at(-1)?.type).toBe("flushed");
  });
  it("stops on the exact sample count, retaining a final short tail without adding silence", () => {
    const { processor, messages } = worklet(32003);
    processor.process([[new Float32Array(33000).fill(0.5)]]);
    const chunks = messages.filter((message) => message.type === "pcm");
    expect(chunks.map((message) => message.samples!.byteLength / 2)).toEqual([
      16000, 16000, 3,
    ]);
    expect(messages.at(-1)?.type).toBe("limit_reached");
    processor.process([[new Float32Array(128).fill(0.1)]]);
    processor.port.onmessage({ data: { type: "flush" } });
    expect(messages.filter((message) => message.type === "pcm")).toHaveLength(
      3,
    );
    expect(messages.at(-1)?.type).toBe("flushed");
  });
  it("rejects invalid or expanded budgets before sampling", () => {
    expect(() => worklet(0)).toThrow();
    expect(() => worklet(9600001)).toThrow();
  });
});
