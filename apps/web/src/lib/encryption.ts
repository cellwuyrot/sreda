import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 16;
const TAG_LENGTH = 16;
const SALT_LENGTH = 16;

function deriveKey(salt: Buffer): Buffer {
  const secret = process.env.ENCRYPTION_SECRET || process.env.NEXTAUTH_SECRET;
  if (!secret) {
    throw new Error("ENCRYPTION_SECRET or NEXTAUTH_SECRET must be set");
  }
  return scryptSync(secret, salt, 32);
}

// Legacy key for decrypting old data with fixed salt
function getLegacyKey(): Buffer {
  const secret = process.env.ENCRYPTION_SECRET || process.env.NEXTAUTH_SECRET;
  if (!secret) {
    throw new Error("ENCRYPTION_SECRET or NEXTAUTH_SECRET must be set");
  }
  return scryptSync(secret, Buffer.from("trioz-site-config-salt"), 32);
}

export function encrypt(plaintext: string): string {
  const salt = randomBytes(SALT_LENGTH);
  const key = deriveKey(salt);
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(plaintext, "utf8", "hex");
  encrypted += cipher.final("hex");
  const tag = cipher.getAuthTag();

  // Format: salt:iv:tag:encrypted (4 parts = new format)
  return `${salt.toString("hex")}:${iv.toString("hex")}:${tag.toString("hex")}:${encrypted}`;
}

export function decrypt(ciphertext: string): string {
  const parts = ciphertext.split(":");

  if (parts.length === 4) {
    // New format: salt:iv:tag:encrypted
    const salt = Buffer.from(parts[0], "hex");
    const iv = Buffer.from(parts[1], "hex");
    const tag = Buffer.from(parts[2], "hex");
    const encrypted = parts[3];
    const key = deriveKey(salt);

    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(tag);
    let decrypted = decipher.update(encrypted, "hex", "utf8");
    decrypted += decipher.final("utf8");
    return decrypted;
  }

  if (parts.length === 3) {
    // Legacy format: iv:tag:encrypted (fixed salt)
    const key = getLegacyKey();
    const iv = Buffer.from(parts[0], "hex");
    const tag = Buffer.from(parts[1], "hex");
    const encrypted = parts[2];

    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(tag);
    let decrypted = decipher.update(encrypted, "hex", "utf8");
    decrypted += decipher.final("utf8");
    return decrypted;
  }

  throw new Error("Invalid encrypted format");
}

export function isEncrypted(value: string): boolean {
  const parts = value.split(":");
  // Support both old (3 parts) and new (4 parts) formats
  if (parts.length === 4 && parts[0].length === SALT_LENGTH * 2 && parts[1].length === IV_LENGTH * 2 && parts[2].length === TAG_LENGTH * 2) {
    return true;
  }
  return parts.length === 3 && parts[0].length === IV_LENGTH * 2 && parts[1].length === TAG_LENGTH * 2;
}
