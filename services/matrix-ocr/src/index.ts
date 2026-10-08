import { createMatrixOcrHttpService } from "./http-service.js";
import { loadConfig } from "./config.js";
import { OnnxMatrixOcrProcessor } from "./onnx-processor.js";
import { HttpStructureClient } from "./structure-client.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const structureClient = config.structureEndpoint
    ? new HttpStructureClient({
        endpoint: config.structureEndpoint,
        token: config.structureToken,
        requestTimeoutSeconds: config.structureRequestTimeoutSeconds,
        maxResponseBytes: config.structureMaxResponseBytes,
        maxUploadBytes: config.structureMaxUploadBytes,
      })
    : undefined;
  const processor = await OnnxMatrixOcrProcessor.create({
    resourcesRoot: config.resourcesRoot,
    dpi: config.dpi,
    maxPages: config.maxPages,
    intraOpThreads: config.intraOpThreads,
    structureClient,
  });
  const service = createMatrixOcrHttpService({
    config,
    processor,
    log: (event) => process.stdout.write(`${JSON.stringify(event)}\n`),
  });
  const close = async (signal: string) => {
    process.stdout.write(
      `${JSON.stringify({ event: "shutdown", signal })}\n`,
    );
    service.closeIdleConnections();
    service.close(async () => {
      await processor.close();
      process.exitCode = 0;
    });
  };
  process.once("SIGINT", () => void close("SIGINT"));
  process.once("SIGTERM", () => void close("SIGTERM"));
  service.listen(config.port, config.bindHost, () => {
    process.stdout.write(
      `${JSON.stringify({
        event: "ready",
        bind_host: config.bindHost,
        port: config.port,
        model_version: processor.modelVersion,
      })}\n`,
    );
  });
}

void main().catch((error: unknown) => {
  process.stderr.write(
    `${JSON.stringify({
      event: "startup_failed",
      message: error instanceof Error ? error.message : "unknown error",
    })}\n`,
  );
  process.exitCode = 1;
});
