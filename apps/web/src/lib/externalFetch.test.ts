import { afterEach, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
vi.mock("node:dns/promises", () => ({ lookup: vi.fn() }));
vi.mock("node:http", () => ({ request: vi.fn() }));
import { lookup } from "node:dns/promises";
import { request } from "node:http";
import { externalFetch } from "./externalFetch";
afterEach(() => vi.clearAllMocks());
it("pins the actual socket lookup to the verified public address", async () => {
  vi.mocked(lookup).mockResolvedValue([{ address: "8.8.8.8", family: 4 }] as never);
  let pinned: unknown;
  vi.mocked(request).mockImplementation((url: unknown, options: unknown, callback: unknown) => {
    expect(String(url)).toBe("http://public.example/image");
    const opts = options as { lookup: (host: string, options: object, cb: (...args: unknown[]) => void) => void };
    opts.lookup("public.example", {}, (...args) => { pinned = args; });
    const req = new EventEmitter() as EventEmitter & { end: () => void };
    req.end = () => {
      const incoming = Object.assign(new PassThrough(), { headers: { "content-type": "text/plain" }, statusCode: 200 });
      (callback as (stream: unknown) => void)(incoming); incoming.end("ok");
    };
    return req as never;
  });
  const response = await externalFetch(new URL("http://public.example/image"), { signal: new AbortController().signal });
  expect(await response.text()).toBe("ok");
  expect(pinned).toEqual([null, "8.8.8.8", 4]);
  expect(lookup).toHaveBeenCalledTimes(1);
});
it("rejects before opening any socket after DNS resolves to private IP", async () => {
  vi.mocked(lookup).mockResolvedValue([{ address: "127.0.0.1", family: 4 }] as never);
  await expect(externalFetch(new URL("http://public.example"), { signal: new AbortController().signal })).rejects.toThrow("Blocked destination");
  expect(request).not.toHaveBeenCalled();
});
it("the deadline covers a hung resolver, with no late connection", async () => {
  vi.mocked(lookup).mockReturnValue(new Promise(() => {}));
  const controller = new AbortController();
  const response = externalFetch(new URL("http://public.example"), { signal: controller.signal });
  controller.abort(new Error("deadline"));
  await expect(response).rejects.toThrow("deadline");
  expect(request).not.toHaveBeenCalled();
});
