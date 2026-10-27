import { lookup } from "node:dns/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { Readable } from "node:stream";
import { isIP } from "node:net";
import { isPublicAddress, safeUrl } from "./urlSafety";

export async function resolvePublicAddress(hostname: string) {
  const host = hostname.replace(/^\[|\]$/g, "");
  const addresses = isIP(host) ? [{ address: host, family: isIP(host) }] : await lookup(host, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(item => !isPublicAddress(item.address))) throw new Error("Blocked destination");
  return addresses[0];
}

/** No automatic redirects and no second DNS lookup: Host/SNI remain the
 * original hostname, while the socket uses the verified public IP. */
export async function externalFetch(url: URL, options: { signal: AbortSignal; headers?: Record<string, string> }): Promise<Response> {
  if (!safeUrl(url.toString())) throw new Error("Blocked URL");
  // DNS can also hang. The caller's deadline covers it, without starting a
  // socket after cancellation; the OS DNS operation itself is not cancellable.
  const address = await new Promise<Awaited<ReturnType<typeof resolvePublicAddress>>>((resolve, reject) => {
    options.signal.throwIfAborted();
    const abort = () => reject(options.signal.reason);
    options.signal.addEventListener("abort", abort, { once: true });
    resolvePublicAddress(url.hostname).then(resolve, reject).finally(() => options.signal.removeEventListener("abort", abort));
  });
  options.signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const request = (url.protocol === "https:" ? httpsRequest : httpRequest)(url, {
      signal: options.signal,
      headers: { ...options.headers, "Accept-Encoding": "identity" },
      lookup: (_host, opts, cb) => {
        if (typeof opts === "object" && opts.all) cb(null, [address]);
        else cb(null, address.address, address.family);
      },
    }, incoming => {
      const headers = new Headers();
      for (const [key, value] of Object.entries(incoming.headers)) {
        if (value) headers.set(key, Array.isArray(value) ? value.join(", ") : value);
      }
      const abort = () => incoming.destroy(new Error("External request aborted"));
      options.signal.addEventListener("abort", abort, { once: true });
      incoming.once("close", () => options.signal.removeEventListener("abort", abort));
      const status = incoming.statusCode || 502;
      // Response forbids a body for these statuses.
      const body = [204, 205, 304].includes(status) ? null : Readable.toWeb(incoming) as ReadableStream<Uint8Array>;
      if (!body) incoming.resume();
      resolve(new Response(body, { status, headers }));
    });
    request.once("error", reject);
    request.end();
  });
}
