import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
export function storageKey() {
  const key = Buffer.from(process.env.TZ_ID_STORAGE_KEY ?? "", "base64");
  if (key.length !== 32)
    throw new Error("TZ_ID_STORAGE_KEY must be a base64-encoded 32-byte key");
  return key;
}
export function encryptTzData(value: unknown): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", storageKey(), iv);
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(value), "utf8"),
    cipher.final(),
  ]);
  return [iv, cipher.getAuthTag(), encrypted]
    .map((part) => part.toString("base64url"))
    .join(".");
}
export function decryptTzData<T>(value: string): T {
  const [iv, tag, data] = value
    .split(".")
    .map((part) => Buffer.from(part, "base64url"));
  const decipher = createDecipheriv("aes-256-gcm", storageKey(), iv);
  decipher.setAuthTag(tag);
  return JSON.parse(
    Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8"),
  ) as T;
}
