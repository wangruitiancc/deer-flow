import { afterEach, describe, expect, it, rs } from "@rstest/core";

import { getBackendBaseURL, getLangGraphBaseURL } from "@/core/config";
import { isStaticWebsiteOnly } from "@/core/static-mode";

afterEach(() => {
  rs.unstubAllEnvs();
});

describe("inlined public URL settings", () => {
  it("keeps the same-origin proxy and existing SSR/mock fallbacks", () => {
    rs.stubEnv("NEXT_PUBLIC_BACKEND_BASE_URL", undefined);
    rs.stubEnv("NEXT_PUBLIC_LANGGRAPH_BASE_URL", undefined);
    expect(getBackendBaseURL()).toBe("");
    expect(getLangGraphBaseURL()).toBe("http://localhost:2026/api/langgraph");
    expect(getLangGraphBaseURL(true)).toBe("http://localhost:3000/mock/api");
  });

  it("preserves public prefix resolution and trailing-slash behavior", () => {
    rs.stubEnv("NEXT_PUBLIC_BACKEND_BASE_URL", "/backend///");
    rs.stubEnv("NEXT_PUBLIC_LANGGRAPH_BASE_URL", "/api/langgraph/");
    expect(getBackendBaseURL()).toBe("http://localhost:2026/backend");
    expect(getLangGraphBaseURL()).toBe("http://localhost:2026/api/langgraph/");
    rs.stubEnv(
      "NEXT_PUBLIC_BACKEND_BASE_URL",
      "https://tenant.example.test/prefix///",
    );
    expect(getBackendBaseURL()).toBe("https://tenant.example.test/prefix");
  });

  it("enables static demos only for the exact existing public flag", () => {
    for (const value of [undefined, "", "false", "TRUE", "1"]) {
      rs.stubEnv("NEXT_PUBLIC_STATIC_WEBSITE_ONLY", value);
      expect(isStaticWebsiteOnly()).toBe(false);
    }
    rs.stubEnv("NEXT_PUBLIC_STATIC_WEBSITE_ONLY", "true");
    expect(isStaticWebsiteOnly()).toBe(true);
  });
});
