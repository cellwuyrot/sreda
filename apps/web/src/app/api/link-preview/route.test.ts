import { beforeEach, it, expect, vi } from "vitest";
import { NextRequest } from "next/server";
vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/rateLimit", () => ({ rateLimit: vi.fn(async () => null) }));
vi.mock("@/lib/externalFetch", () => ({ externalFetch: vi.fn() }));
import { getServerSession } from "next-auth";
import { externalFetch } from "@/lib/externalFetch";
import { GET } from "./route";
let seq = 0;
const request = (url?: string) =>
  new NextRequest(
    "https://trioz.ru/api/link-preview?url=" +
      encodeURIComponent(url || `https://outside${++seq}.example/article`),
  );
const html = (body: string) =>
  new Response(`<html><head>${body}</head><body>ignored</body></html>`, {
    headers: { "content-type": "text/html" },
  });
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getServerSession).mockResolvedValue({ user: { id: "u" } } as never);
});
it("requires authentication before requesting an external website", async () => {
  vi.mocked(getServerSession).mockResolvedValue(null);
  expect((await GET(request())).status).toBe(401);
  expect(externalFetch).not.toHaveBeenCalled();
});
it("supports third-party branding and resolves relative image and icon", async () => {
  vi.mocked(externalFetch).mockResolvedValue(
    html(
      '<meta property="og:title" content="External article"><meta property="og:image" content="/cover.webp"><meta name="theme-color" content="#FF6600"><link href="/brand.png" rel="icon">',
    ),
  );
  const response = await GET(request("https://brand.example/post"));
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({
    title: "External article",
    themeColor: "#FF6600",
    image:
      "/api/link-preview/image?url=https%3A%2F%2Fbrand.example%2Fcover.webp",
    favicon:
      "/api/link-preview/image?url=https%3A%2F%2Fbrand.example%2Fbrand.png",
  });
});
it("never imports a site's stylesheet or script", async () => {
  vi.mocked(externalFetch).mockResolvedValue(
    html(
      '<title>Plain</title><script>steal()</script><link rel="stylesheet" href="https://evil.example/a.css"><meta name="theme-color" content="url(https://evil.example)">',
    ),
  );
  const d = await (await GET(request())).json();
  expect(d.themeColor).toBeNull();
  expect(Object.keys(d).sort()).toEqual(
    [
      "url",
      "title",
      "description",
      "image",
      "siteName",
      "themeColor",
      "favicon",
    ].sort(),
  );
  expect(externalFetch).toHaveBeenCalledTimes(1);
});
it("rejects private network targets", async () => {
  expect((await GET(request("http://127.0.0.1/private"))).status).toBe(400);
  expect(externalFetch).not.toHaveBeenCalled();
});
it("rejects private network OG images and favicons", async () => {
  vi.mocked(externalFetch).mockResolvedValue(
    html(
      '<title>Page</title><meta property="og:image" content="http://127.0.0.1/a"><link rel="icon" href="http://169.254.169.254/a">',
    ),
  );
  expect(await (await GET(request())).json()).toMatchObject({
    image: null,
    favicon: null,
  });
});
it("works without image or brand metadata", async () => {
  vi.mocked(externalFetch).mockResolvedValue(
    html("<title>Regular external site</title>"),
  );
  expect(await (await GET(request())).json()).toMatchObject({
    title: "Regular external site",
    image: null,
    themeColor: null,
  });
});
it("does not follow an unsafe redirect", async () => {
  vi.mocked(externalFetch).mockResolvedValue(
    new Response(null, {
      status: 302,
      headers: { location: "http://127.0.0.1/admin" },
    }),
  );
  expect((await GET(request())).status).toBe(404);
  expect(externalFetch).toHaveBeenCalledTimes(1);
});
it("uses Twitter image when OG is absent", async () => {
  vi.mocked(externalFetch).mockResolvedValue(
    html(
      '<title>Video</title><meta name="twitter:image" content="https://cdn.example/video.jpg">',
    ),
  );
  expect((await (await GET(request())).json()).image).toContain("cdn.example");
});
