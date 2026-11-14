/** Strict validation at the privileged Windows boundary. Never log the profile.
 * This does not authorize a user; issuance checks the fresh project ADMIN role.
 * This is not a Windows runner and does not enable the pilot by itself.
 */
const staticLines: ReadonlyArray<string | null> = [
  'loglevel = "info"',
  'vpn_mode = "general"',
  'killswitch_enabled = true',
  '',
  '[endpoint]',
  'hostname = "turn.trioz.ru"',
  'addresses = ["170.168.18.20:8443"]',
  null,
  null,
  'skip_verification = false',
  'upstream_protocol = "http2"',
  '',
  '[listener.tun]',
  'included_routes = ["0.0.0.0/0", "2000::/3"]',
  'excluded_routes = ["10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16"]',
  'mtu_size = 1350',
  '',
];
export function isValidTrustTunnelPilotProfile(input: unknown): input is string {
  if (typeof input !== 'string' || input.length > 4096 || input.includes('\r')) return false;
  const lines = input.split('\n');
  if (lines.length !== staticLines.length) return false;
  return lines.every((line, index) => {
    if (index === 7) return /^username = "trioz_[a-f0-9]{32}"$/.test(line);
    if (index === 8) return /^password = "[A-Za-z0-9_-]{43}"$/.test(line);
    return line === staticLines[index];
  });
}
