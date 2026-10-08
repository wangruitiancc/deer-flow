import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { HttpStructureClient, parseResponse } from "../src/structure-client.js";

const TOKEN = "structure-test-token-with-32-characters";

function validResponse() {
  return {
    version: "matrix-structure-http-v1",
    model_version: "fixture-structure",
    width_pixels: 100,
    height_pixels: 200,
    blocks: [
      {
        structure_index: 0,
        reading_order: 0,
        kind: "table",
        text: "A\tB",
        bbox: [0.1, 0.2, 0.9, 0.8],
        confidence: 0.9,
        structure: {
          type: "table",
          rows: 1,
          columns: 2,
          cells: [
            { row: 0, column: 0, row_span: 1, column_span: 1, text: "A" },
            { row: 0, column: 1, row_span: 1, column_span: 1, text: "B" },
          ],
        },
      },
      {
        structure_index: 1,
        reading_order: 1,
        kind: "formula",
        text: "x^2",
        bbox: [0.2, 0.85, 0.8, 0.95],
        confidence: null,
        structure: { type: "formula", latex: "x^2" },
      },
    ],
  };
}

test("strict structure parser accepts table/formula and rejects overlap", () => {
  const blocks = parseResponse(validResponse());
  assert.deepEqual(
    blocks.map((block) => block.kind),
    ["table", "formula"],
  );
  const invalid = validResponse();
  invalid.blocks[0]!.structure.cells![1]!.column = 0;
  assert.throws(() => parseResponse(invalid), /overlap/);
});

test("HTTP structure client authenticates, seals digest and parses response", async () => {
  const root = await mkdtemp(join(tmpdir(), "matrix-structure-client-"));
  const imagePath = join(root, "page.png");
  const image = Buffer.from("fixture-page-image");
  await writeFile(imagePath, image);
  const server = createServer(async (request, response) => {
    assert.equal(request.headers.authorization, `Bearer ${TOKEN}`);
    if (request.url === "/v1/structure/health") {
      const body = Buffer.from(
        JSON.stringify({
          version: "matrix-structure-http-v1",
          capabilities: { table_structure: true, formula_structure: true },
        }),
      );
      response.writeHead(200, { "Content-Length": body.length });
      response.end(body);
      return;
    }
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const received = Buffer.concat(chunks);
    assert.deepEqual(received, image);
    assert.equal(
      request.headers["x-structure-source-sha256"],
      createHash("sha256").update(image).digest("hex"),
    );
    const body = Buffer.from(JSON.stringify(validResponse()));
    response.writeHead(200, { "Content-Length": body.length });
    response.end(body);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address() as AddressInfo;
    const client = new HttpStructureClient({
      endpoint: `http://127.0.0.1:${address.port}`,
      token: TOKEN,
      requestTimeoutSeconds: 10,
      maxResponseBytes: 1024 * 1024,
      maxUploadBytes: 1024,
    });
    assert.deepEqual(await client.checkReady(), {
      tableStructure: true,
      formulaStructure: true,
    });
    const blocks = await client.analyze({
      imagePath,
      enableTable: true,
      enableFormula: true,
      signal: new AbortController().signal,
    });
    assert.equal(blocks[0]!.structure?.type, "table");
    assert.equal(blocks[1]!.structure?.type, "formula");
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    await rm(root, { recursive: true, force: true });
  }
});
