/** Internal TrustTunnel v1.1.12 pilot profile. The result contains a password. */
import { isIP } from "node:net";
export interface TrustTunnelPilotConfigInput {
  hostname: string;
  gatewayIpv4: string;
  port: number;
  username: string;
  password: string;
}
export function buildTrustTunnelPilotConfig(input: TrustTunnelPilotConfigInput): string {
  if (!input || typeof input.hostname !== "string" || input.hostname.length > 253 ||
      !/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(input.hostname) ||
      typeof input.gatewayIpv4 !== "string" || isIP(input.gatewayIpv4) !== 4 ||
      !Number.isInteger(input.port) || input.port < 1 || input.port > 65535 ||
      typeof input.username !== "string" || !/^trioz_[a-f0-9]{32}$/.test(input.username) ||
      typeof input.password !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(input.password)) {
    throw new Error("Invalid TrustTunnel pilot configuration");
  }
  return [
    'loglevel = "info"', 'vpn_mode = "general"', 'killswitch_enabled = true', '', '[endpoint]',
    `hostname = ${JSON.stringify(input.hostname)}`,
    `addresses = [${JSON.stringify(`${input.gatewayIpv4}:${input.port}`)}]`,
    `username = ${JSON.stringify(input.username)}`, `password = ${JSON.stringify(input.password)}`,
    'skip_verification = false', 'upstream_protocol = "http2"', '', '[listener.tun]',
    'included_routes = ["0.0.0.0/0", "2000::/3"]',
    'excluded_routes = ["10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16"]',
    'mtu_size = 1350', '',
  ].join("\n");
}
