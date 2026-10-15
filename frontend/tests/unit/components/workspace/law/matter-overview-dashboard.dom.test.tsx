import { afterEach, describe, expect, it, rs } from "@rstest/core";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

rs.mock("@/core/i18n/hooks", () => ({ useI18n: () => ({ locale: "zh-CN" }) }));
rs.mock("@/core/law", () => ({
  useLawCaseWorkbench: rs.fn(),
  useLawCaseWorkbenchDeadlines: () => ({
    data: { pages: [] },
    hasNextPage: false,
    isPending: false,
  }),
  useLawCaseWorkbenchEvents: rs.fn(),
}));

import { MatterOverviewDashboard } from "@/components/workspace/law/matter-overview-dashboard";
import { useLawCaseWorkbench, type Matter } from "@/core/law";

afterEach(cleanup);
const matter = {
  id: "synthetic-matter",
  tenant_id: "synthetic-tenant",
  title: "合成案件",
} as Matter;

describe("case overview malformed response", () => {
  for (const data of [{ items: [] }, { statistics: {} }]) {
    it(`shows a recoverable unavailable state rather than crashing for ${JSON.stringify(data)}`, () => {
      const refetch = rs.fn();
      rs.mocked(useLawCaseWorkbench).mockReturnValue({
        data,
        isPending: false,
        isError: false,
        refetch,
      } as unknown as ReturnType<typeof useLawCaseWorkbench>);
      render(<MatterOverviewDashboard matter={matter} />);
      expect(screen.getByRole("alert").textContent).toContain(
        "统计未加载，不以零值代替",
      );
      expect(screen.queryByText("有效材料")).toBeNull();
      fireEvent.click(screen.getByRole("button", { name: "重试" }));
      expect(refetch).toHaveBeenCalledTimes(1);
    });
  }
});
