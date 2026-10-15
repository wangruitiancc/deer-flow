#!/usr/bin/env node

import { spawn } from "node:child_process";
import { readFile, stat, writeFile } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const DEMO_THREAD_ID = "7cfa5f8f-a2f8-47ad-acbd-da7137baf990";
export const ROUTES = [
  "/",
  "/login",
  "/workspace/chats",
  `/workspace/chats/${DEMO_THREAD_ID}`,
  "/en/docs",
  "/blog/posts",
];

/**
 * @param {boolean} staticWebsiteOnly
 * @param {Readonly<Record<string, string | undefined>>} baseEnvironment
 */
export function createBuildEnvironment(
  staticWebsiteOnly,
  baseEnvironment = process.env,
) {
  const environment = { ...baseEnvironment };
  if (staticWebsiteOnly) {
    environment.NEXT_PUBLIC_STATIC_WEBSITE_ONLY = "true";
  } else {
    delete environment.NEXT_PUBLIC_STATIC_WEBSITE_ONLY;
  }
  return environment;
}

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const frontendDir = path.resolve(scriptDir, "..");

export function extractAssetPaths(html) {
  const assets = { css: [], js: [] };
  const seen = { css: new Set(), js: new Set() };
  const attributePattern = /(?:src|href)=["']([^"']+)["']/g;
  for (const match of html.matchAll(attributePattern)) {
    const value = match[1];
    if (!value?.startsWith("/_next/static/")) continue;
    const relativePath = value.slice("/_next/static/".length).split("?", 1)[0];
    if (!relativePath) continue;
    const kind = relativePath.endsWith(".css")
      ? "css"
      : relativePath.endsWith(".js")
        ? "js"
        : null;
    if (kind && !seen[kind].has(relativePath)) {
      seen[kind].add(relativePath);
      assets[kind].push(relativePath);
    }
  }
  return assets;
}

export function evaluateBudgets(measurements, budgets) {
  const failures = [];
  for (const [route, limits] of Object.entries(budgets)) {
    const actual = measurements[route];
    if (!actual) {
      failures.push(`${route}: route was not measured`);
      continue;
    }
    if (actual.error) {
      failures.push(`${route}: ${actual.error}`);
      continue;
    }
    if (limits.redirectTo) {
      if (
        actual.kind !== "redirect" ||
        actual.target !== limits.redirectTo ||
        actual.status !== limits.redirectStatus
      ) {
        failures.push(
          `${route}: expected HTTP ${limits.redirectStatus} redirect to ${limits.redirectTo}`,
        );
      }
      continue;
    }
    if (actual.kind === "redirect") {
      failures.push(
        `${route}: a redirect cannot replace page asset measurement`,
      );
      continue;
    }
    for (const kind of ["css", "js"]) {
      if (actual[kind] <= limits[kind]) continue;
      const overage = actual[kind] - limits[kind];
      failures.push(
        `${route} ${kind}: ${actual[kind]} bytes exceeds ${limits[kind]} bytes by ${overage} ${overage === 1 ? "byte" : "bytes"}`,
      );
    }
  }
  return failures;
}

export function formatMeasurementSummary(measurements) {
  const lines = ["Route asset summary"];
  for (const [route, measurement] of Object.entries(measurements)) {
    if (measurement.kind === "redirect") {
      lines.push(
        `${route} [${measurement.buildMode}] REDIRECT ${measurement.status} to ${measurement.target}; no page assets`,
      );
      continue;
    }
    if (measurement.error) {
      lines.push(
        `${route} [${measurement.buildMode}] UNMEASURED: ${measurement.error}`,
      );
      continue;
    }
    lines.push(
      `${route} [${measurement.buildMode}] JS ${measurement.js} B | CSS ${measurement.css} B | HTML ${measurement.html} B`,
    );
  }
  return lines.join("\n");
}

async function getFreePort() {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("Failed to allocate a local port"));
        return;
      }
      const { port } = address;
      server.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: frontendDir,
      env: process.env,
      stdio: "inherit",
      ...options,
    });
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exited with ${code ?? signal}`));
    });
  });
}

async function waitForServer(baseUrl, child) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Next.js server exited with ${child.exitCode}`);
    }
    try {
      const response = await fetch(baseUrl, { redirect: "manual" });
      if (response.status < 500) return;
    } catch {
      // The server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Timed out waiting for the Next.js production server");
}

export async function measureRedirect(
  baseUrl,
  route,
  expected,
  request = fetch,
) {
  const source = new URL(route, baseUrl);
  const target = new URL(expected.redirectTo, baseUrl);
  if (source.origin !== target.origin || target.username || target.password) {
    throw new Error(`${route} has an invalid redirect contract`);
  }
  const response = await request(source.href, { redirect: "manual" });
  const location = response.headers.get("location");
  if (
    response.status !== expected.redirectStatus ||
    !location ||
    new URL(location, source).href !== target.href
  ) {
    throw new Error(`${route} did not preserve its retired-page redirect`);
  }
  await response.body?.cancel();
  return { kind: "redirect", status: response.status, target: target.pathname };
}

export async function readRouteHtml(baseUrl, route, request = fetch) {
  const origin = new URL(baseUrl).origin;
  let current = new URL(route, baseUrl);
  const visited = new Set();
  const redirects = [];
  for (let hop = 0; hop <= 5; hop += 1) {
    if (current.origin !== origin || current.username || current.password) {
      throw new Error(
        `${route} redirected outside the local measurement origin`,
      );
    }
    if (visited.has(current.href)) {
      throw new Error(`${route} has a redirect cycle`);
    }
    visited.add(current.href);
    const response = await request(current.href, { redirect: "manual" });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      if (!location)
        throw new Error(`${route} returned a redirect without a location`);
      const target = new URL(location, current);
      if (
        route !== "/login" &&
        ["/login", "/setup"].includes(target.pathname)
      ) {
        throw new Error(
          `${route} redirected to authentication instead of its page`,
        );
      }
      redirects.push({
        from: current.pathname,
        to: target.pathname,
        status: response.status,
      });
      current = target;
      continue;
    }
    if (!response.ok)
      throw new Error(`${route} returned HTTP ${response.status}`);
    const expectedPaths =
      route === "/"
        ? ["/admin", "/workspace/law"]
        : route === "/workspace/chats"
          ? ["/workspace/law"]
          : [new URL(route, baseUrl).pathname];
    if (!expectedPaths.includes(current.pathname)) {
      throw new Error(
        `${route} resolved to a different page; assets were not measured`,
      );
    }
    return {
      html: await response.text(),
      resolvedRoute: current.pathname,
      redirects,
    };
  }
  throw new Error(`${route} exceeded the local redirect limit`);
}

async function measureRoute(baseUrl, route) {
  const { html, resolvedRoute, redirects } = await readRouteHtml(
    baseUrl,
    route,
  );
  const assets = extractAssetPaths(html);
  const totals = { css: 0, js: 0 };
  for (const kind of ["css", "js"]) {
    for (const relativePath of assets[kind]) {
      const assetPath = path.join(frontendDir, ".next", "static", relativePath);
      totals[kind] += (await stat(assetPath)).size;
    }
  }
  return {
    ...totals,
    assets,
    html: Buffer.byteLength(html),
    resolvedRoute,
    redirects,
  };
}

async function measureBuild(routes, staticWebsiteOnly, budgets) {
  const env = createBuildEnvironment(staticWebsiteOnly);
  await run("pnpm", ["exec", "next", "build"], {
    env,
  });

  const port = await getFreePort();
  const server = spawn(
    "pnpm",
    [
      "exec",
      "next",
      "start",
      "--hostname",
      "127.0.0.1",
      "--port",
      String(port),
    ],
    {
      cwd: frontendDir,
      env,
      stdio: ["ignore", "inherit", "inherit"],
    },
  );

  try {
    const baseUrl = `http://127.0.0.1:${port}`;
    await waitForServer(baseUrl, server);
    const measurements = {};
    for (const route of routes) {
      const buildMode = staticWebsiteOnly ? "static-demo" : "normal";
      try {
        const result = budgets[route]?.redirectTo
          ? await measureRedirect(baseUrl, route, budgets[route])
          : await measureRoute(baseUrl, route);
        measurements[route] = {
          ...result,
          buildMode,
        };
      } catch (error) {
        measurements[route] = {
          buildMode,
          error:
            error instanceof Error ? error.message : "route measurement failed",
        };
      }
    }
    return measurements;
  } finally {
    if (server.exitCode === null) {
      await new Promise((resolve) => {
        const forceStop = setTimeout(() => server.kill("SIGKILL"), 5_000);
        server.once("exit", () => {
          clearTimeout(forceStop);
          resolve();
        });
        server.kill("SIGTERM");
      });
    }
  }
}

async function main() {
  const check = process.argv.includes("--check");
  const budgets = JSON.parse(
    await readFile(path.join(frontendDir, "performance-budgets.json"), "utf8"),
  );
  const measurements = {
    ...(await measureBuild(["/login"], false, budgets)),
    ...(await measureBuild(
      ROUTES.filter((route) => route !== "/login"),
      true,
      budgets,
    )),
  };
  await writeFile(
    path.join(frontendDir, ".next", "performance-results.json"),
    `${JSON.stringify(measurements, null, 2)}\n`,
  );
  process.stdout.write(`${JSON.stringify(measurements, null, 2)}\n`);
  process.stdout.write(`${formatMeasurementSummary(measurements)}\n`);

  if (check) {
    const failures = evaluateBudgets(measurements, budgets);
    if (failures.length > 0) {
      throw new Error(`Route asset budgets failed:\n${failures.join("\n")}`);
    }
  }
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch((error) => {
    process.stderr.write(
      `${error instanceof Error ? error.stack : String(error)}\n`,
    );
    process.exitCode = 1;
  });
}
