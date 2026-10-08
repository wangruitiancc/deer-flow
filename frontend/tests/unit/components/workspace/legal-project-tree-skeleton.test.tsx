import { describe, expect, it, rs } from "@rstest/core";
import { renderToString } from "react-dom/server";

import { LegalProjectTreeSkeleton } from "@/components/workspace/law/legal-project-tree-skeleton";

describe("legal sidebar loading markup", () => {
  it("is deterministic across server and client and never uses random widths", () => {
    const random = rs.spyOn(Math, "random");
    try {
      expect(renderToString(<LegalProjectTreeSkeleton showIcon />)).toBe(
        renderToString(<LegalProjectTreeSkeleton showIcon />),
      );
      expect(random).not.toHaveBeenCalled();
      expect(renderToString(<LegalProjectTreeSkeleton />)).toContain("w-3/4");
    } finally {
      random.mockRestore();
    }
  });
});
