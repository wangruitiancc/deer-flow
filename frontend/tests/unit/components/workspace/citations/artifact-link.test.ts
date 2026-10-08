import { describe, expect, it } from "@rstest/core";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { ArtifactLink } from "@/components/workspace/citations/artifact-link";

// Render-level coverage for the .md artifact preview link renderer: a
// prompt-injected javascript:/data: href must never reach a real anchor in
// the main document (mirrors the MarkdownLink guard).
describe("ArtifactLink rendering", () => {
  it("does not resolve project snapshot relative links against the active conversation", () => {
    const html = renderToStaticMarkup(
      createElement(
        ArtifactLink,
        { href: "/mnt/user-data/outputs/other.md", allowRelativeLinks: false },
        "related file",
      ),
    );
    expect(html).not.toContain("href=");
    expect(html).toContain("related file");
  });
  it("renders an unsafe href as a disabled span, never an anchor", () => {
    const html = renderToStaticMarkup(
      createElement(ArtifactLink, { href: "javascript:alert(1)" }, "click me"),
    );
    expect(html).not.toContain("<a");
    expect(html).toContain("<span");
    expect(html).toContain("click me");
    expect(html).not.toContain("href=");
  });

  it("renders a safe https href as a hardened anchor", () => {
    const html = renderToStaticMarkup(
      createElement(ArtifactLink, { href: "https://example.com/x" }, "site"),
    );
    expect(html).toContain("<a");
    expect(html).toContain('href="https://example.com/x"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
  });

  it("renders citation labels when children are React elements", () => {
    const html = renderToStaticMarkup(
      createElement(
        ArtifactLink,
        { href: "https://example.com/report" },
        createElement("span", null, "citation:Test Source"),
      ),
    );
    expect(html).not.toContain("citation:");
    expect(html).toContain("Test Source");
  });

  it("renders scheme-less relative hrefs as navigable anchors", () => {
    const tests = ["report.md", "./report.md", "../assets/chart.png"];
    for (const href of tests) {
      const html = renderToStaticMarkup(
        createElement(ArtifactLink, { href }, "doc"),
      );
      expect(html).toContain("<a");
      expect(html).toContain(`href="${href}"`);
    }
  });
});
