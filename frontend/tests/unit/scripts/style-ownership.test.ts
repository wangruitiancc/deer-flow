import { readFileSync, readdirSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

import { describe, expect, it } from "@rstest/core";
import ts from "typescript";

const root = path.resolve(__dirname, "../../..");
const source = path.join(root, "src");
const require = createRequire(path.join(root, "package.json"));
const read = (p: string) => readFileSync(p, "utf8");
function files(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const p = path.join(directory, entry.name);
    return entry.isDirectory() ? files(p) : [p];
  });
}

describe("route-owned utility styles", () => {
  it("erases shell-only auth types instead of eagerly running the schema module", () => {
    for (const relative of [
      "core/auth/AuthProvider.tsx",
      "components/workspace/gateway-offline-banner.tsx",
    ]) {
      const { outputText } = ts.transpileModule(
        read(path.join(source, relative)),
        {
          compilerOptions: {
            module: ts.ModuleKind.ESNext,
            jsx: ts.JsxEmit.ReactJSX,
            verbatimModuleSyntax: true,
          },
        },
      );
      expect(outputText, relative).not.toMatch(
        /^import[^;]*from ["'](?:@\/core\/auth\/types|\.\/types)["']/m,
      );
    }
  });
  it("covers every rendered page through a stylesheet-owning layout", () => {
    const app = path.join(source, "app");
    for (const page of files(app).filter((p) => p.endsWith("/page.tsx"))) {
      if (page === path.join(app, "page.tsx")) {
        expect(read(page)).toContain("redirect(");
        continue;
      }
      let directory = path.dirname(page);
      let owned = false;
      while (directory.startsWith(app)) {
        const layout = path.join(directory, "layout.tsx");
        if (
          existsSync(layout) &&
          /@\/styles\/(?:auth|admin|workbench|globals)\.css/.test(read(layout))
        )
          owned = true;
        directory = path.dirname(directory);
      }
      expect(owned, path.relative(source, page)).toBe(true);
    }
  });

  it("includes every AI element reachable from application imports", () => {
    const ai = path.join(source, "components/ai-elements");
    const imports = (p: string) =>
      ts
        .preProcessFile(read(p), true, true)
        .importedFiles.map((entry) => {
          if (
            !entry.fileName.startsWith("@/") &&
            !entry.fileName.startsWith(".")
          )
            return undefined;
          const base = entry.fileName.startsWith("@/")
            ? path.join(source, entry.fileName.slice(2))
            : path.resolve(path.dirname(p), entry.fileName);
          return [
            base,
            `${base}.tsx`,
            `${base}.ts`,
            path.join(base, "index.tsx"),
            path.join(base, "index.ts"),
          ].find(
            (candidate) =>
              existsSync(candidate) && /\.(?:tsx?|jsx?)$/.test(candidate),
          );
        })
        .filter((p): p is string => p?.startsWith(`${ai}/`) === true);
    const queue = files(source)
      .filter((p) => /\.(?:tsx?|jsx?)$/.test(p) && !p.startsWith(`${ai}/`))
      .flatMap(imports);
    const reached = new Set<string>();
    while (queue.length) {
      const next = queue.pop()!;
      if (reached.has(next)) continue;
      reached.add(next);
      queue.push(...imports(next));
    }
    const css = read(path.join(source, "styles/workbench.css"));
    expect(reached.size).toBeGreaterThan(0);
    for (const p of reached)
      expect(css, path.relative(source, p)).toContain(
        `@source "../${path.relative(source, p)}";`,
      );
  });

  it("retains rich-content utilities and shared theme rules outside the login bundle", async () => {
    const postcss = require("postcss");
    const tailwind = require("@tailwindcss/postcss");
    const compile = async (name: string) => {
      const from = path.join(source, "styles", name);
      return (
        await postcss([tailwind({ base: root })]).process(read(from), { from })
      ).css as string;
    };
    const auth = await compile("auth.css");
    const workbench = await compile("workbench.css");
    expect(workbench).toContain(".font-mono");
    expect(workbench).toContain(".whitespace-pre-wrap");
    expect(workbench).not.toContain(".text-neutral-950");
    expect(auth).not.toContain(".text-neutral-950");
    for (const css of [auth, workbench]) {
      expect(css).toContain("--background:");
      expect(css).toContain("--sidebar:");
      expect(css).toContain(".dark");
    }
  });
});
