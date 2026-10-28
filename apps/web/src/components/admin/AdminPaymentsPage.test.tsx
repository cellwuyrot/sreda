import { describe, expect, it, vi } from "vitest";
vi.mock("next/navigation", () => ({ redirect: vi.fn((url: string) => { throw new Error(`REDIRECT:${url}`); }) }));
import AdminPaymentsPage from "@/app/admin/payments/page";
describe("retired main-project payment screen", () => {
  it("redirects old payment bookmarks to subscriptions instead of rendering payment forms", () => {
    expect(() => AdminPaymentsPage()).toThrow("REDIRECT:/admin/premium");
  });
});
