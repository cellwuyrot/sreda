const { chromium } = require('playwright');
const http = require('http'); const fs = require('fs');
const path = require('path'); const os = require('os');
const qaDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sreda-browser-'));
require('esbuild').buildSync({entryPoints:[path.join(__dirname,'browser-entry.tsx')],outfile:path.join(qaDir,'app.js'),bundle:true,platform:'browser',format:'iife',jsx:'automatic',define:{'process.env.NODE_ENV':'"production"'}});
fs.writeFileSync(path.join(qaDir,'index.html'), '<!doctype html><html><head><meta charset="utf-8"></head><body><div id="root"></div><script src="/app.js"></script></body></html>');
(async () => {
  const server = http.createServer((req,res) => { const file = req.url === '/app.js' ? 'app.js' : 'index.html'; res.setHeader('Content-Type',file.endsWith('js')?'text/javascript':'text/html'); res.end(fs.readFileSync(path.join(qaDir,file))); });
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  let browser;
  try {
    browser = await chromium.launch({ ...(process.env.CHROMIUM_PATH ? {executablePath:process.env.CHROMIUM_PATH} : {}), headless:true, args:['--no-sandbox','--autoplay-policy=no-user-gesture-required'] });
    const page = await browser.newPage();
    const errors=[]; page.on('pageerror',e=>errors.push(e.message));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    const input=page.getByLabel('Название'); await input.waitFor();
    if(!await input.evaluate(e=>e===document.activeElement)) throw Error('input focus lost');
    await page.keyboard.type('новый канал');
    if(await input.inputValue() !== 'новый канал') throw Error('typing failed');
    // The test dialog has no CSS; explicitly click the standalone surface.
    await page.getByRole('button',{name:'На весь экран',exact:true}).click();
    await page.waitForFunction(()=>document.fullscreenElement?.id==='surface');
    await page.getByRole('button',{name:'Выйти из полноэкранного режима'}).click();
    await page.waitForFunction(()=>!document.fullscreenElement);
    const voice = await page.evaluate(async () => {
      async function scenario(listenerInitiates) {
        const listener=new RTCPeerConnection({iceServers:[]}); const sender=new RTCPeerConnection({iceServers:[]});
        const ctx=new AudioContext(); const dest=ctx.createMediaStreamDestination(); const oscillator=ctx.createOscillator(); oscillator.connect(dest); oscillator.start();
        window.ensureVoiceReceiver(listener,null); sender.addTrack(dest.stream.getAudioTracks()[0],dest.stream);
        listener.onicecandidate=e=>{if(e.candidate) sender.addIceCandidate(e.candidate).catch(()=>{});};
        sender.onicecandidate=e=>{if(e.candidate) listener.addIceCandidate(e.candidate).catch(()=>{});};
        const received=new Promise((resolve,reject)=>{
          const timeout=setTimeout(()=>reject(Error('audio track timeout')),10000);
          listener.ontrack=e=>{clearTimeout(timeout); resolve({kind:e.track.kind, streams:e.streams.length});};
        });
        try {
          const initiator=listenerInitiates?listener:sender; const responder=listenerInitiates?sender:listener;
          const offer=await initiator.createOffer(); await initiator.setLocalDescription(offer); await responder.setRemoteDescription(offer);
          const answer=await responder.createAnswer(); await responder.setLocalDescription(answer); await initiator.setRemoteDescription(answer);
          const track=await received;
          await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('ICE timeout')),10000);const check=()=>{if(listener.connectionState==='connected'){clearTimeout(timer);resolve();}};listener.onconnectionstatechange=check;check();});
          return {listenerInitiates,track,connected:listener.connectionState==='connected',hasAudio:offer.sdp.includes('m=audio')};
        } finally {listener.close();sender.close();oscillator.stop();dest.stream.getTracks().forEach(t=>t.stop());await ctx.close();}
      }
      return [await scenario(true),await scenario(false)];
    });
    const e2ee = await page.evaluate(async () => {
      const api = window.e2ee;
      const alice = await api.getOrCreateKeyPair('alice');
      const bob = await api.getOrCreateKeyPair('bob');
      if (alice.publicKeyJwk.x === bob.publicKeyJwk.x) throw Error('account key leak');
      let blockedExport = false;
      try { await api.exportKeysToJSON('alice'); } catch { blockedExport = true; }
      if (!blockedExport) throw Error('nonextractable key exported');
      const pair = await crypto.subtle.generateKey({name:'ECDH',namedCurve:'P-256'},true,['deriveKey','deriveBits']);
      const backup = {publicKey:await crypto.subtle.exportKey('jwk',pair.publicKey),privateKey:await crypto.subtle.exportKey('jwk',pair.privateKey)};
      let remote = null, fail = true, ambiguous = false;
      const originalFetch = window.fetch;
      window.fetch = async (url, options) => {
        if (options?.method === 'POST') {
          if (fail) return new Response('{}',{status:500});
          remote = JSON.parse(options.body).publicKey;
          if (ambiguous) throw Error('lost response');
          return new Response('{}');
        }
        return new Response(JSON.stringify({publicKey:remote}));
      };
      try {
        if (await api.importKeysFromJSON(JSON.stringify(backup),'alice',true)) throw Error('failed server accepted');
        if ((await api.getOrCreateKeyPair('alice')).publicKeyJwk.x !== alice.publicKeyJwk.x) throw Error('old active lost');
        fail = false; ambiguous = true;
        if (await api.importKeysFromJSON(JSON.stringify(backup),'alice',true)) throw Error('lost response reported success');
        if ((await api.getOrCreateKeyPair('alice')).publicKeyJwk.x !== backup.publicKey.x) throw Error('staged recovery failed');
        return {accountIsolation:'PASS',nonextractableExport:'PASS',failedImportRetainsActive:'PASS',ambiguousCommitRecovery:'PASS',webLocksSupported:!!navigator.locks};
      } finally { window.fetch = originalFetch; }
    });
    if(errors.length) throw Error(errors.join('; '));
    fs.writeFileSync(path.join(__dirname,'browser-results.json'),JSON.stringify({e2ee,chromium:await browser.version(),focusAndTyping:'PASS',nativeFullscreenEnterExit:'PASS',voice,errors},null,2));
    console.log(JSON.stringify({e2ee,focusAndTyping:'PASS',nativeFullscreenEnterExit:'PASS',voice}));
    await browser.close();server.close();fs.rmSync(qaDir,{recursive:true,force:true});process.exit(0);
  } catch(e){console.error(e);if(browser)await browser.close();server.close();fs.rmSync(qaDir,{recursive:true,force:true});process.exit(1);}
})();
