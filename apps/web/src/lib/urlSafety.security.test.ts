import { expect, it, vi } from "vitest";
vi.mock("node:dns/promises", () => ({ lookup: vi.fn() }));
import { lookup } from "node:dns/promises";
import { safeUrl, isPublicAddress } from "./urlSafety";
import { resolvePublicAddress } from "./externalFetch";
it.each(["127.0.0.1", "[::ffff:127.0.0.1]", "[::]", "100.64.0.1", "[fc00::1]", "169.254.169.254"])("blocks non-public literal %s", host => {
  expect(safeUrl(`http://${host}/`)).toBeNull();
});
it("does not confuse normal domain prefixes with IPv6", () => expect(safeUrl("https://fcdn.example.org")).not.toBeNull());
it.each(["8.8.8.8", "2606:4700:4700::1111"])("accepts public address %s", ip => expect(isPublicAddress(ip)).toBe(true));
it("rejects private DNS answers, including mixed address sets", async () => {
  vi.mocked(lookup).mockResolvedValue([{ address: "8.8.8.8", family: 4 }, { address: "10.0.0.1", family: 4 }] as never);
  await expect(resolvePublicAddress("public.example")).rejects.toThrow("Blocked");
});
it("returns a verified IP for socket pinning", async () => {
  vi.mocked(lookup).mockResolvedValue([{ address: "8.8.8.8", family: 4 }] as never);
  expect(await resolvePublicAddress("public.example")).toEqual({ address: "8.8.8.8", family: 4 });
});
it("rejects URL credentials and non-http schemes", () => {
  expect(safeUrl("https://user:password@example.org")).toBeNull(); expect(safeUrl("file:///etc/passwd")).toBeNull();
});
