class Pcm16CaptureProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.maxSamples = options?.processorOptions?.maxSamples ?? 9600000;
    if (
      !Number.isSafeInteger(this.maxSamples) ||
      this.maxSamples < 1 ||
      this.maxSamples > 9600000
    )
      throw new Error("Invalid PCM capture sample budget");
    this.totalSamples = 0;
    this.stopped = false;
    this.buffer = new Int16Array(16000);
    this.length = 0;
    this.port.onmessage = (event) => {
      if (event.data?.type === "flush") {
        this.flush();
        this.port.postMessage({ type: "flushed" });
      }
    };
  }

  process(inputs) {
    const channel = inputs[0]?.[0];
    if (!channel || this.stopped) return true;
    for (let index = 0; index < channel.length; index += 1) {
      const sample = Math.max(-1, Math.min(1, channel[index] ?? 0));
      this.buffer[this.length] = sample < 0 ? sample * 32768 : sample * 32767;
      this.length += 1;
      this.totalSamples += 1;
      if (this.length === this.buffer.length) this.flush();
      if (this.totalSamples === this.maxSamples) {
        this.stopped = true;
        this.flush();
        this.port.postMessage({ type: "limit_reached" });
        break;
      }
    }
    return true;
  }

  flush() {
    if (this.length === 0) return;
    const output = this.buffer.slice(0, this.length);
    this.port.postMessage({ type: "pcm", samples: output.buffer }, [
      output.buffer,
    ]);
    this.length = 0;
  }
}

registerProcessor("matrix-law-pcm16-capture", Pcm16CaptureProcessor);
