/** Shared strict parser for offline pilot payloads. Does not log input. */
import { isIP } from 'node:net';
const fail = () => { throw new Error('Invalid or unsafe input'); };
export function check(doc) {
  if (!doc || typeof doc !== 'object' || !Array.isArray(doc.accounts) || doc.accounts.length < 1 || doc.accounts.length > 100) fail();
  const ids = new Set(), names = new Set(), passwords = new Set();
  for (const r of doc.accounts) {
    if (!r || typeof r !== 'object' || Array.isArray(r) ||
        typeof r.accountId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(r.accountId) || ids.has(r.accountId) ||
        typeof r.username !== 'string' || !/^trioz_[a-f0-9]{32}$/.test(r.username) || names.has(r.username) ||
        typeof r.password !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(r.password) || passwords.has(r.password) ||
        typeof r.hostname !== 'string' || r.hostname.length > 253 || !/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(r.hostname) ||
        typeof r.gatewayIpv4 !== 'string' || isIP(r.gatewayIpv4) !== 4 ||
        !Number.isInteger(r.port) || r.port < 1 || r.port > 65535) fail();
    ids.add(r.accountId); names.add(r.username); passwords.add(r.password);
    // Refuse extra keys rather than accidentally encrypting unrelated secrets.
    if (Object.keys(r).sort().join(',') !== 'accountId,gatewayIpv4,hostname,password,port,username') fail();
  }
  if (Object.keys(doc).join(',') !== 'accounts') fail();
}
