/** .conf names are not UAPI names; HPK uses hex, not base64, in UAPI. */
export const AWG3_UAPI: Record<string, string> = {
  headerprotectionkey: "header_protection_key",
  contentpaddingaddition: "content_padding_addition",
  rekeyaftertime: "rekey_after_time", rekeytimeout: "rekey_timeout",
  rejectaftertime: "reject_after_time", keepalivetimeout: "keepalive_timeout",
  maxhandshakeattempts: "max_handshake_attempts",
  randomtrailers: "random_trailers", disablecookies: "disable_cookies",
};
export function awgExtraUapi(key: string, value: string): string {
  if (/[\r\n]/.test(key + value)) throw new Error("Некорректный параметр AWG");
  let wireValue = value;
  if (key === "headerprotectionkey") {
    if (!/^[A-Za-z0-9+/]{42}[AEIMQUYcgkosw048]=$/.test(value)) throw new Error("Некорректный HeaderProtectionKey");
    wireValue = Buffer.from(value, "base64").toString("hex");
  }
  return `${AWG3_UAPI[key] || key}=${wireValue}`;
}
