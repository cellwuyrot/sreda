import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
import { getServerSession } from "next-auth";
import { POST } from "./route";
beforeEach(() => vi.clearAllMocks());
describe("retired global provider API", () => {
  it("rejects non-admin users", async () => {
    vi.mocked(getServerSession).mockResolvedValue({ user: { role: "USER" } } as never);
    expect((await POST()).status).toBe(403);
  });
  it("does not permit an admin to change everyone’s provider", async () => {
    vi.mocked(getServerSession).mockResolvedValue({ user: { role: "ADMIN" } } as never);
    expect((await POST()).status).toBe(410);
  });
});
