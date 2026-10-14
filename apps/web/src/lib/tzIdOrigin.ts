/** Cookie-authenticated management actions must originate from the web app itself. */
export function tzIdSameOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  const trusted = new URL(process.env.NEXTAUTH_URL || req.url).origin;
  return !!origin && origin === trusted;
}
