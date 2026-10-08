import { afterEach, describe, expect, it, rs } from "@rstest/core";
import { act, cleanup, render, screen } from "@testing-library/react";

rs.mock("next/dynamic", () => ({
  default:
    () =>
    ({ document }: { document: { title: string } }) => <p>{document.title}</p>,
}));
rs.mock("@/core/law", () => ({ useLawThreadContext: () => ({ data: null }) }));
rs.mock("@/core/law/legal-authorities", () => ({
  parseLegalAuthorities: rs.fn(),
  LEGAL_AUTHORITIES_ERROR: "法律依据校验失败",
}));

import { LegalAuthoritiesPreview } from "@/components/workspace/law/legal-authorities-preview";
import {
  parseLegalAuthorities,
  type LegalAuthorities,
} from "@/core/law/legal-authorities";

afterEach(() => {
  cleanup();
  rs.resetAllMocks();
});
describe("asynchronous legal source hash validation", () => {
  it("hides previous content immediately and ignores hashes completing out of order", async () => {
    let resolve!: (value: LegalAuthorities) => void;
    rs.mocked(parseLegalAuthorities)
      .mockResolvedValueOnce({ title: "第一份文件" } as LegalAuthorities)
      .mockReturnValueOnce(
        new Promise((done) => {
          resolve = done;
        }),
      )
      .mockRejectedValueOnce(new Error());
    const view = render(<LegalAuthoritiesPreview content="first" />);
    await screen.findByText("第一份文件");
    view.rerender(<LegalAuthoritiesPreview content="second" />);
    expect(screen.queryByText("第一份文件")).toBeNull();
    view.rerender(<LegalAuthoritiesPreview content="bad" />);
    await screen.findByRole("alert");
    await act(async () => {
      resolve({ title: "迟到文件" } as LegalAuthorities);
    });
    expect(screen.queryByText("迟到文件")).toBeNull();
    expect(screen.getByRole("alert").textContent).toBe("法律依据校验失败");
  });
});
