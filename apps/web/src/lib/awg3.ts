/** AWG 3.x options. Preserve explicit zero/false; never invent server settings. */
export const AWG3_RANGE_KEYS = [
  "ContentPaddingAddition", "RekeyAfterTime", "RekeyTimeout", "RejectAfterTime",
  "KeepaliveTimeout", "MaxHandshakeAttempts",
] as const;
export const AWG3_TOGGLE_KEYS = ["RandomTrailers", "DisableCookies"] as const;
export const AWG3_KEYS = ["HeaderProtectionKey", ...AWG3_RANGE_KEYS, ...AWG3_TOGGLE_KEYS] as const;
export const AWG_PROFILE_KEYS = [
  "Jc", "Jmin", "Jmax", "S1", "S2", "S3", "S4", "H1", "H2", "H3", "H4",
  "I1", "I2", "I3", "I4", "I5", ...AWG3_KEYS,
] as const;

/** Throws a parameter name, never a key value. No silent downgrade of 3.x. */
export function normalizeAwg3(source: Record<string, unknown>): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  for (const key of AWG3_KEYS) {
    if (source[key] === undefined) continue;
    const raw = source[key];
    if (typeof raw !== "string" && typeof raw !== "number" && typeof raw !== "boolean") {
      throw new Error(`Некорректный параметр ${key}`);
    }
    const text = String(raw).trim();
    if (key === "HeaderProtectionKey") {
      // Canonical 32-byte base64, including the final padding bits.
      if (!/^[A-Za-z0-9+/]{42}[AEIMQUYcgkosw048]=$/.test(text)) {
        throw new Error("Некорректный HeaderProtectionKey");
      }
      out[key] = text;
    } else if ((AWG3_TOGGLE_KEYS as readonly string[]).includes(key)) {
      if (!/^(0|1|true|false)$/i.test(text)) throw new Error(`Некорректный параметр ${key}`);
      out[key] = /^(1|true)$/i.test(text) ? "1" : "0";
    } else {
      if (!/^\d{1,5}(-\d{1,5})?$/.test(text)) throw new Error(`Некорректный параметр ${key}`);
      const [lo, hi = lo] = text.split("-").map(Number);
      if (lo > hi || hi > 65535) throw new Error(`Некорректный диапазон ${key}`);
      out[key] = text.includes("-") ? `${lo}-${hi}` : String(lo);
    }
  }
  const hpk = out.HeaderProtectionKey;
  if (hpk && hpk !== "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=") {
    for (const key of ["S1", "S2", "S3", "S4"]) {
      if (!Number.isInteger(Number(source[key])) || Number(source[key]) < 12) {
        throw new Error(`${key} должен быть не меньше 12 при HeaderProtectionKey`);
      }
    }
  }
  return out;
}
