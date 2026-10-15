import { describe, expect, it } from "@rstest/core";

import {
  createBuildEnvironment,
  evaluateBudgets,
  extractAssetPaths,
  formatMeasurementSummary,
  measureRedirect,
  readRouteHtml,
  ROUTES,
} from "../../../scripts/measure-route-assets.mjs";

describe("route asset measurement", () => {
  it("records a retired route as a checked redirect without fake zero-byte assets", async () => {
    const contract = {
      redirectTo: "/workspace/law",
      redirectStatus: 307,
      css: 270000,
      js: 4200000,
    };
    const result = await measureRedirect(
      "http://127.0.0.1:4310",
      "/en/docs",
      contract,
      async () =>
        new Response(null, {
          status: 307,
          headers: { location: "/workspace/law" },
        }),
    );
    expect(result).toEqual({
      kind: "redirect",
      status: 307,
      target: "/workspace/law",
    });
    expect(
      evaluateBudgets({ "/en/docs": result }, { "/en/docs": contract }),
    ).toEqual([]);
    expect(
      formatMeasurementSummary({
        "/en/docs": { ...result, buildMode: "static-demo" },
      }),
    ).toContain("REDIRECT 307 to /workspace/law; no page assets");
  });

  it("fails retired-route contracts on a served page, status change or external destination", async () => {
    const contract = { redirectTo: "/workspace/law", redirectStatus: 307 };
    for (const response of [
      new Response("page", { status: 200 }),
      new Response(null, {
        status: 308,
        headers: { location: "/workspace/law" },
      }),
      new Response(null, {
        status: 307,
        headers: { location: "https://example.com/workspace/law" },
      }),
    ]) {
      await expect(
        measureRedirect(
          "http://127.0.0.1:4310",
          "/en/docs",
          contract,
          async () => response,
        ),
      ).rejects.toThrow("retired-page redirect");
    }
  });

  it("never treats a redirect as a passing ordinary page budget", () => {
    expect(
      evaluateBudgets(
        {
          "/login": { kind: "redirect", status: 307, target: "/workspace/law" },
        },
        { "/login": { css: 170000, js: 850000 } },
      ),
    ).toEqual(["/login: a redirect cannot replace page asset measurement"]);
    expect(
      evaluateBudgets(
        { "/en/docs": { css: 1, js: 1 } },
        { "/en/docs": { redirectTo: "/workspace/law", redirectStatus: 307 } },
      ),
    ).toEqual(["/en/docs: expected HTTP 307 redirect to /workspace/law"]);
  });

  it("covers every approved representative route", () => {
    expect(ROUTES).toContain("/login");
  });

  it("removes an inherited static-mode flag from the normal build", () => {
    expect(
      createBuildEnvironment(false, {
        KEEP_ME: "yes",
        NEXT_PUBLIC_STATIC_WEBSITE_ONLY: "true",
      }),
    ).toEqual({ KEEP_ME: "yes" });
    expect(createBuildEnvironment(true, {})).toEqual({
      NEXT_PUBLIC_STATIC_WEBSITE_ONLY: "true",
    });
  });

  it("extracts unique Next.js scripts and styles", () => {
    const html = `
      <link rel="stylesheet" href="/_next/static/css/app.css?dpl=1">
      <script src="/_next/static/chunks/app.js"></script>
      <script src="/_next/static/chunks/app.js"></script>
      <script src="https://cdn.example.com/external.js"></script>
    `;

    expect(extractAssetPaths(html)).toEqual({
      css: ["css/app.css"],
      js: ["chunks/app.js"],
    });
  });

  it("reports every route budget overage with exact values", () => {
    const result = evaluateBudgets(
      {
        "/": { css: 101, js: 200 },
        "/en/docs": { css: 50, js: 301 },
      },
      {
        "/": { css: 100, js: 200 },
        "/en/docs": { css: 50, js: 300 },
      },
    );

    expect(result).toEqual([
      "/ css: 101 bytes exceeds 100 bytes by 1 byte",
      "/en/docs js: 301 bytes exceeds 300 bytes by 1 byte",
    ]);
  });

  it("measures the final legal page after an intentional local redirect", async () => {
    const visited: string[] = [];
    const result = await readRouteHtml(
      "http://127.0.0.1:4310",
      "/workspace/chats",
      async (input) => {
        const url = String(input);
        visited.push(url);
        return url.endsWith("/workspace/chats")
          ? new Response(null, {
              status: 307,
              headers: { location: "/workspace/law" },
            })
          : new Response("legal workspace", { status: 200 });
      },
    );
    expect(visited).toEqual([
      "http://127.0.0.1:4310/workspace/chats",
      "http://127.0.0.1:4310/workspace/law",
    ]);
    expect(result).toEqual({
      html: "legal workspace",
      resolvedRoute: "/workspace/law",
      redirects: [
        { from: "/workspace/chats", to: "/workspace/law", status: 307 },
      ],
    });
  });

  it("never counts an authentication fallback as workspace performance", async () => {
    for (const route of ["/", "/workspace/chats"]) {
      await expect(
        readRouteHtml(
          "http://127.0.0.1:4310",
          route,
          async () =>
            new Response(null, {
              status: 307,
              headers: { location: "/login?next=%2Fworkspace" },
            }),
        ),
      ).rejects.toThrow("authentication instead of its page");
    }
  });

  it("does not fetch a cross-origin redirect destination", async () => {
    let calls = 0;
    await expect(
      readRouteHtml("http://127.0.0.1:4310", "/", async () => {
        calls += 1;
        return new Response(null, {
          status: 302,
          headers: { location: "https://example.com/workspace/law" },
        });
      }),
    ).rejects.toThrow("outside the local measurement origin");
    expect(calls).toBe(1);
  });

  it("does not count a retired public route redirect as that page's assets", async () => {
    await expect(
      readRouteHtml("http://127.0.0.1:4310", "/en/docs", async (input) =>
        String(input).endsWith("/en/docs")
          ? new Response(null, {
              status: 307,
              headers: { location: "/workspace/law" },
            })
          : new Response("workspace", { status: 200 }),
      ),
    ).rejects.toThrow("different page; assets were not measured");
  });

  it("keeps unavailable routes as explicit failures without zero-byte evidence", () => {
    const measurements = {
      "/en/docs": { buildMode: "static-demo", error: "different page" },
    };
    expect(
      evaluateBudgets(measurements, {
        "/en/docs": { css: 270000, js: 4200000 },
      }),
    ).toEqual(["/en/docs: different page"]);
    expect(formatMeasurementSummary(measurements)).toContain(
      "UNMEASURED: different page",
    );
  });

  it("bounds cyclic and unending local redirects", async () => {
    await expect(
      readRouteHtml(
        "http://127.0.0.1:4310",
        "/",
        async () =>
          new Response(null, { status: 307, headers: { location: "/" } }),
      ),
    ).rejects.toThrow("redirect cycle");
    let calls = 0;
    await expect(
      readRouteHtml(
        "http://127.0.0.1:4310",
        "/",
        async () =>
          new Response(null, {
            status: 307,
            headers: { location: `/step-${++calls}` },
          }),
      ),
    ).rejects.toThrow("redirect limit");
    expect(calls).toBe(6);
  });

  it("formats a stable human-readable route summary", () => {
    expect(
      formatMeasurementSummary({
        "/": { css: 12, js: 345, html: 67, buildMode: "static-demo" },
      }),
    ).toBe(
      "Route asset summary\n/ [static-demo] JS 345 B | CSS 12 B | HTML 67 B",
    );
  });
});
