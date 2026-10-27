import { afterEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
vi.mock("next-auth", () => ({ getServerSession: vi.fn().mockResolvedValue({ user: { id: "u" } }) }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/rateLimit", () => ({ rateLimit: vi.fn().mockResolvedValue(null) }));
vi.mock("@/lib/externalFetch", () => ({ externalFetch: vi.fn() }));
import { externalFetch } from "@/lib/externalFetch";
import { GET } from "./route";
const req = () => new NextRequest("https://test/api/link-preview/image?url=https%3A%2F%2Fpublic.example%2Fimage");
afterEach(() => { vi.useRealTimers(); vi.clearAllMocks(); });
it("aborts body reading even after headers have arrived", async () => {
  vi.useFakeTimers();
  vi.mocked(externalFetch).mockImplementation(async (_url, { signal }) => new Response(new ReadableStream({ start(controller) {
    signal.addEventListener("abort", () => controller.error(new Error("slow body")), { once: true });
  } }), { headers: { "content-type": "image/png" } }));
  const response = GET(req());
  await vi.advanceTimersByTimeAsync(8001);
  expect((await response).status).toBe(504);
});
it("rejects a redirect to private IP before a second request", async () => {
  vi.mocked(externalFetch).mockResolvedValue(new Response(null, { status: 302, headers: { location: "http://127.0.0.1/private" } }));
  expect((await GET(req())).status).toBe(404);
  expect(externalFetch).toHaveBeenCalledTimes(1);
});
it("closes upstream after rejecting a content type", async () => {
  const cancel = vi.fn();
  vi.mocked(externalFetch).mockResolvedValue(new Response(new ReadableStream({ cancel }), { headers: { "content-type": "image/svg+xml" } }));
  expect((await GET(req())).status).toBe(415);
  expect(cancel).toHaveBeenCalledTimes(1);
});
