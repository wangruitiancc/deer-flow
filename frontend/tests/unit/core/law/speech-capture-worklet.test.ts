import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";

import { describe, expect, it } from "@rstest/core";

function worklet(maxSamples: number) {
  type Message = { type: string; samples?: ArrayBuffer };
  type Processor = {
    process(inputs: Float32Array[][]): boolean;
    port: { onmessage: (event: { data: { type: string } }) => void };
  };
  let Constructor!: new (options: object) => Processor;
  const messages: Message[] = [];
  runInNewContext(
    readFileSync(resolve("public/worklets/pcm16-capture.js"), "utf8"),
    {
      AudioWorkletProcessor: class {
        port = {
          postMessage: (message: Message) => messages.push(message),
          onmessage: () => undefined,
        };
      },
      registerProcessor: (_name: string, type: typeof Constructor) => {
        Constructor = type;
      },
    },
  );
  return {
    processor: new Constructor({ processorOptions: { maxSamples } }),
    messages,
  };
}

describe("PCM worklet sample budget", () => {
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
