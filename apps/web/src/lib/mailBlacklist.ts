import fs from "fs";
import path from "path";

export type BlacklistEntry = {
  id: string;
  address: string;
  note: string;
  addedAt: string;
};

export function mailBlacklistPath(): string {
  return path.join(process.cwd(), "data", "mail-blacklist.json");
}

export function readMailBlacklist(): BlacklistEntry[] {
  try {
    const parsed = JSON.parse(fs.readFileSync(mailBlacklistPath(), "utf8"));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function writeMailBlacklist(list: BlacklistEntry[]): void {
  const target = mailBlacklistPath();
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const temporary = `${target}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(list, null, 2), "utf8");
  fs.renameSync(temporary, target);
}

export function normalizeSenderAddress(value: string): string {
  const match = /<([^<>]+)>/.exec(value);
  return (match ? match[1] : value).trim().toLowerCase();
}

/** Exact mailbox match, or exact domain match for entries like @example.com. */
export function isBlacklistedSender(value: string, entries = readMailBlacklist()): boolean {
  const sender = normalizeSenderAddress(value);
  const at = sender.lastIndexOf("@");
  const domain = at >= 0 ? sender.slice(at) : "";
  return entries.some((entry) => {
    const rule = entry.address.trim().toLowerCase();
    return rule.startsWith("@") ? domain === rule : sender === rule;
  });
}