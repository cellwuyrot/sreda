/** Backend-only companion to a standard OIDC client. Does not implement OAuth/JWT itself. */
export function tzIdProjectApi(accessToken: string) {
  if (!accessToken) throw new Error("OIDC access token required");
  const issuer = "https://id.trioz.ru";
  async function request(path: string, method = "GET", body?: unknown) {
    const response = await fetch(`${issuer}${path}`, {
      method,
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(10000),
      cache: "no-store",
    });
    if (response.status === 401) throw new Error("TZ ID session expired/revoked: refresh via OIDC client or sign in again");
    if (!response.ok) throw new Error(`TZ ID API: HTTP ${response.status}`);
    return response.json();
  }
  return {
    // Compare userinfo.sub to the OIDC-verified subject before using these claims.
    profile: () => request("/userinfo"),
    contact: () => request("/api/v1/contact"),
    subscriptions: () => request("/api/v1/subscriptions"),
    publishSubscription: (subscription: { externalId: string; title: string; status: "active" | "canceled" | "expired"; expiresAt: string | null }) => request("/api/v1/subscriptions", "PUT", subscription),
    notify: (notification: { externalId: string; title: string; body: string; url?: string }) => request("/api/v1/notifications", "POST", notification),
  };
}
