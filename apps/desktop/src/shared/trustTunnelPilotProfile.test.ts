import { describe, expect, it } from 'vitest';
import { isValidTrustTunnelPilotProfile } from './trustTunnelPilotProfile';
import { buildTrustTunnelPilotConfig } from '../../../web/src/lib/trustTunnelClientConfig';
const profile = () => buildTrustTunnelPilotConfig({hostname:'turn.trioz.ru', gatewayIpv4:'170.168.18.20', port:8443, username:'trioz_'+'a'.repeat(32), password:'Z'.repeat(43)});
describe('Windows TrustTunnel pilot privileged-profile guard', () => {
  it('accepts the server-generated canonical HTTP2 TLS profile', () => expect(isValidTrustTunnelPilotProfile(profile())).toBe(true));
  it('rejects changed endpoint, weakened TLS and protocol', () => {
    for (const changed of [profile().replace('turn.trioz.ru','bad.example'), profile().replace('170.168.18.20','192.0.2.1'), profile().replace('skip_verification = false','skip_verification = true'), profile().replace('"http2"','"http3"')])
      expect(isValidTrustTunnelPilotProfile(changed)).toBe(false);
  });
  it('rejects injections, extra directives and invalid shapes', () => {
    for (const changed of [profile()+'debug = true\n', profile().replace('Z'.repeat(43),'Z'.repeat(42)+'"\n'), profile().replace(/\n/g,'\r\n'), '', {}, 'x'.repeat(4097)])
      expect(isValidTrustTunnelPilotProfile(changed)).toBe(false);
  });
});
