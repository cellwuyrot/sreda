import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import tls from 'node:tls';
import os from 'node:os';
import path from 'node:path';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { createGateway, parseGatewayConfig } from './trusttunnel-gateway.mjs';

const valid = { TRIOZ_TT_GATEWAY_PORT:'8443', TRIOZ_TT_GATEWAY_TARGET_IPV6:'::1', TRIOZ_TT_GATEWAY_TARGET_PORT:'8444', TRIOZ_TT_GATEWAY_ALLOWED_IPV4:'127.0.0.1' };
const publicIngress = {
  ...valid,
  TRIOZ_TT_GATEWAY_ALLOW_ANY_IPV4:'true',
  TRIOZ_TT_GATEWAY_ALLOWED_IPV4:'',
};
const listen = (server, host) => new Promise((resolve,reject) => { server.once('error',reject); server.listen(0,host,()=>resolve(server.address().port)); });
const close = server => new Promise(resolve => server.close(resolve));
function exchange(port, data) {
  return new Promise((resolve,reject)=>{
    const c=net.connect({host:'127.0.0.1',port,allowHalfOpen:true}); let result='';
    c.setTimeout(3000,()=>c.destroy(new Error('timeout')));
    c.on('data',d=>{result+=d.toString();}); c.on('error',reject);
    c.on('end',()=>resolve(result)); c.on('connect',()=>c.end(data));
  });
}

test('configuration requires explicit IPv6 destination and exact IPv4 allowlist', () => {
  const c=parseGatewayConfig(valid); assert.equal(c.bindHost,'127.0.0.1'); assert.ok(c.allowed.has('127.0.0.1'));
  for (const patch of [
    {TRIOZ_TT_GATEWAY_ALLOWED_IPV4:''}, {TRIOZ_TT_GATEWAY_ALLOWED_IPV4:'0.0.0.0'},
    {TRIOZ_TT_GATEWAY_ALLOWED_IPV4:'127.0.0.0/8'}, {TRIOZ_TT_GATEWAY_TARGET_IPV6:'127.0.0.1'},
    {TRIOZ_TT_GATEWAY_TARGET_IPV6:'::ffff:127.0.0.1'}, {TRIOZ_TT_GATEWAY_TARGET_IPV6:'::FFFF:7f00:1'}, {TRIOZ_TT_GATEWAY_BIND:'0.0.0.0'},
    {TRIOZ_TT_GATEWAY_PORT:'0'}, {TRIOZ_TT_GATEWAY_TARGET_PORT:'65536'},
    {TRIOZ_TT_GATEWAY_MAX_CONNECTIONS:'0'}, {TRIOZ_TT_GATEWAY_IDLE_MS:'-1'},
  ]) assert.throws(()=>parseGatewayConfig({...valid,...patch}));
});

test('public IPv4 ingress is explicit, rejects a mixed policy, and requires bounded limits', () => {
  const c=parseGatewayConfig(publicIngress);
  assert.equal(c.allowAnyIpv4,true);
  assert.equal(c.allowed.size,0);
  assert.equal(c.maxConnectionsPerSource,16);
  assert.equal(c.sourceRatePerMinute,60);
  assert.equal(c.sourceBurst,20);
  assert.throws(()=>parseGatewayConfig({...valid,TRIOZ_TT_GATEWAY_ALLOWED_IPV4:''}));
  assert.throws(()=>parseGatewayConfig({...publicIngress,TRIOZ_TT_GATEWAY_ALLOWED_IPV4:'127.0.0.1'}));
  assert.throws(()=>parseGatewayConfig({...publicIngress,TRIOZ_TT_GATEWAY_MAX_PER_SOURCE:'0'}));
  assert.throws(()=>parseGatewayConfig({...publicIngress,TRIOZ_TT_GATEWAY_SOURCE_RATE_PER_MINUTE:'-1'}));
});

test('passes bytes across IPv4 to IPv6 and preserves request half-close', async t => {
  const target=net.createServer({allowHalfOpen:true}, c=>{let data=''; c.on('data',b=>data+=b); c.on('end',()=>c.end('reply:'+data));});
  let targetPort;
  try { targetPort=await listen(target,'::1'); } catch(e) { if(e.code==='EAFNOSUPPORT'||e.code==='EADDRNOTAVAIL') return t.skip('IPv6 unavailable'); throw e; }
  const config=parseGatewayConfig({...publicIngress,TRIOZ_TT_GATEWAY_TARGET_PORT:String(targetPort)});
  const gateway=createGateway(config); const port=await listen(gateway.server,'127.0.0.1');
  try { assert.equal(await exchange(port,'request'), 'reply:request'); }
  finally { gateway.destroyAll(); await close(gateway.server); await close(target); }
});

test('rejects an unlisted source without connecting to target', async t => {
  let hits=0; const target=net.createServer(c=>{hits++;c.destroy();});
  let targetPort;
  try { targetPort=await listen(target,'::1'); } catch(e) { if(e.code==='EAFNOSUPPORT'||e.code==='EADDRNOTAVAIL') return t.skip('IPv6 unavailable'); throw e; }
  const gateway=createGateway(parseGatewayConfig({...valid,TRIOZ_TT_GATEWAY_TARGET_PORT:String(targetPort),TRIOZ_TT_GATEWAY_ALLOWED_IPV4:'192.0.2.1'}));
  const port=await listen(gateway.server,'127.0.0.1');
  try {
    const c=net.connect(port,'127.0.0.1'); c.on('error',()=>{}); await once(c,'close');
    assert.equal(hits,0); assert.equal(gateway.active(),0);
  } finally { gateway.destroyAll(); await close(gateway.server); await close(target); }
});

test('connection cap denies additional clients and shutdown releases active sockets', async t => {
  const target=net.createServer(c=>c.on('error',()=>{})); let targetPort;
  try { targetPort=await listen(target,'::1'); } catch(e) { if(e.code==='EAFNOSUPPORT'||e.code==='EADDRNOTAVAIL') return t.skip('IPv6 unavailable'); throw e; }
  const gateway=createGateway(parseGatewayConfig({...valid,TRIOZ_TT_GATEWAY_TARGET_PORT:String(targetPort),TRIOZ_TT_GATEWAY_MAX_CONNECTIONS:'1'}));
  const port=await listen(gateway.server,'127.0.0.1');
  let first;
  try {
    const accepted=once(target,'connection'); first=net.connect(port,'127.0.0.1'); first.on('error',()=>{}); await accepted;
    assert.equal(gateway.active(),1);
    const second=net.connect(port,'127.0.0.1'); second.on('error',()=>{}); await once(second,'close');
    assert.equal(gateway.active(),1);
  } finally { first?.destroy(); gateway.destroyAll(); await close(gateway.server); await close(target); }
});

test('per-source connection cap denies a second active socket from the same IPv4', async t => {
  let hits=0;
  const target=net.createServer(c=>{hits++;c.on('error',()=>{});});
  let targetPort;
  try { targetPort=await listen(target,'::1'); } catch(e) { if(e.code==='EAFNOSUPPORT'||e.code==='EADDRNOTAVAIL') return t.skip('IPv6 unavailable'); throw e; }
  const gateway=createGateway(parseGatewayConfig({
    ...valid,
    TRIOZ_TT_GATEWAY_TARGET_PORT:String(targetPort),
    TRIOZ_TT_GATEWAY_MAX_CONNECTIONS:'4',
    TRIOZ_TT_GATEWAY_MAX_PER_SOURCE:'1',
    TRIOZ_TT_GATEWAY_SOURCE_BURST:'4',
  }));
  const port=await listen(gateway.server,'127.0.0.1');
  let first;
  try {
    const accepted=once(target,'connection');
    first=net.connect(port,'127.0.0.1'); first.on('error',()=>{});
    await accepted;
    const second=net.connect(port,'127.0.0.1'); second.on('error',()=>{});
    await once(second,'close');
    assert.equal(hits,1);
    assert.equal(gateway.active(),1);
  } finally { first?.destroy(); gateway.destroyAll(); await close(gateway.server); await close(target); }
});

test('public ingress applies a per-source token bucket', async t => {
  let hits=0;
  const target=net.createServer(c=>{hits++;c.on('error',()=>{});});
  let targetPort;
  try { targetPort=await listen(target,'::1'); } catch(e) { if(e.code==='EAFNOSUPPORT'||e.code==='EADDRNOTAVAIL') return t.skip('IPv6 unavailable'); throw e; }
  const gateway=createGateway(parseGatewayConfig({
    ...publicIngress,
    TRIOZ_TT_GATEWAY_TARGET_PORT:String(targetPort),
    TRIOZ_TT_GATEWAY_MAX_PER_SOURCE:'2',
    TRIOZ_TT_GATEWAY_SOURCE_BURST:'1',
    TRIOZ_TT_GATEWAY_SOURCE_RATE_PER_MINUTE:'1',
  }));
  const port=await listen(gateway.server,'127.0.0.1');
  let first;
  try {
    const accepted=once(target,'connection');
    first=net.connect(port,'127.0.0.1'); first.on('error',()=>{});
    await accepted;
    const second=net.connect(port,'127.0.0.1'); second.on('error',()=>{});
    await once(second,'close');
    assert.equal(hits,1);
    assert.equal(gateway.active(),1);
  } finally { first?.destroy(); gateway.destroyAll(); await close(gateway.server); await close(target); }
});


test('passes through TLS with hostname and certificate verification', async t => {
  if (spawnSync('openssl', ['version']).status !== 0) return t.skip('openssl unavailable');
  const dir=mkdtempSync(path.join(os.tmpdir(),'trioz-gateway-tls-'));
  let target, gateway;
  try {
    const key=path.join(dir,'key.pem'), cert=path.join(dir,'cert.pem');
    const result=spawnSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',key,'-out',cert,'-days','1','-subj','/CN=trioz-test.invalid','-addext','subjectAltName=DNS:trioz-test.invalid'], {stdio:'ignore'});
    assert.equal(result.status,0);
    target=tls.createServer({key:readFileSync(key),cert:readFileSync(cert)}, c=>{ c.on('error',()=>{}); c.on('data',()=>c.end('secure-response')); });
    let targetPort;
    try { targetPort=await listen(target,'::1'); } catch(e) { if(e.code==='EAFNOSUPPORT'||e.code==='EADDRNOTAVAIL') return t.skip('IPv6 unavailable'); throw e; }
    gateway=createGateway(parseGatewayConfig({...valid,TRIOZ_TT_GATEWAY_TARGET_PORT:String(targetPort)}));
    const port=await listen(gateway.server,'127.0.0.1');
    const resultText=await new Promise((resolve,reject)=>{
      const c=tls.connect({host:'127.0.0.1',port,servername:'trioz-test.invalid',ca:readFileSync(cert)},()=>c.write('request'));
      let data=''; c.setTimeout(3000,()=>c.destroy(new Error('timeout'))); c.on('data',b=>data+=b); c.on('error',reject); c.on('end',()=>resolve(data));
    });
    assert.equal(resultText,'secure-response');
    await assert.rejects(new Promise((resolve,reject)=>{
      const c=tls.connect({host:'127.0.0.1',port,servername:'wrong.invalid',ca:readFileSync(cert)},()=>{ c.destroy(); resolve(); });
      c.setTimeout(3000,()=>c.destroy(new Error('timeout'))); c.on('error',reject);
    }), {code:'ERR_TLS_CERT_ALTNAME_INVALID'});
  } finally {
    if(gateway) { gateway.destroyAll(); await close(gateway.server); }
    if(target?.listening) await close(target);
    rmSync(dir,{recursive:true,force:true});
  }
});

test('fails closed when the IPv6 backend is not listening', async () => {
  const reserve=net.createServer(); let targetPort;
  try { targetPort=await listen(reserve,'::1'); } catch(e) { if(e.code==='EAFNOSUPPORT'||e.code==='EADDRNOTAVAIL') return; throw e; }
  await close(reserve);
  const gateway=createGateway(parseGatewayConfig({...valid,TRIOZ_TT_GATEWAY_TARGET_PORT:String(targetPort)}));
  const port=await listen(gateway.server,'127.0.0.1');
  try {
    const c=net.connect(port,'127.0.0.1'); c.on('error',()=>{}); await once(c,'close');
    await new Promise(resolve=>setTimeout(resolve,20));
    assert.equal(gateway.active(),0);
  } finally { gateway.destroyAll(); await close(gateway.server); }
});
