/** Local Chromium regression harness; never connects to the user's browser. */
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { pathToFileURL } = require('node:url');
const { execFileSync } = require('node:child_process');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const esbuild = require('esbuild');
const root = path.resolve(__dirname, '../../..');
const output = fs.mkdtempSync(path.join(os.tmpdir(), 'trioz-chat-scroll-'));
esbuild.buildSync({ entryPoints: [path.join(__dirname, 'fixture.tsx')], bundle: true,
  outfile: path.join(output, 'fixture.js'), alias: { '@': path.join(root, 'apps/web/src') },
  nodePaths: [path.join(root, 'node_modules')], define: { 'process.env.NODE_ENV': '"production"' } });
fs.writeFileSync(path.join(output, 'fixture.html'), '<html><body><div id="root"></div><script src="fixture.js"></script></body></html>');
let browser;
(async()=>{
 browser=await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || execFileSync('which', ['chromium'], {encoding:'utf8'}).trim(), headless:true, args:['--no-sandbox'] });
 const page=await browser.newPage(); const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(pathToFileURL(path.join(output,'fixture.html')).href);await page.waitForFunction(()=>window.qa);
 const wait=()=>page.waitForTimeout(120);
 const position=()=>page.evaluate(()=>window.qa.capture());
 const assert=async(name,before)=>{await wait();const after=await position();const okay=after&&before&&after.id===before.id&&Math.abs(after.offset-before.offset)<2;console.log(name,JSON.stringify({before,after,okay}));if(!okay)throw new Error(name);};
 await page.evaluate(()=>window.qa.tail());await wait();
 // Go up slowly through changing windows with variable row heights.
 for(let i=0;i<30;i++){const expected=await page.evaluate(()=>{document.getElementById('scroller').scrollTop-=220;return window.qa.capture();});await wait();const after=await position();if(!expected||!after||expected.id!==after.id||Math.abs(expected.offset-after.offset)>2)throw new Error('manual upward scroll shifted at step '+i+JSON.stringify({expected,after}));}console.log('30 upward scroll steps stable');
 let before=await position();await page.evaluate(()=>window.qa.prepend());await assert('prepend',before);
 before=await position();await page.evaluate(()=>window.qa.append());await assert('append while reading',before);
 before=await position();await page.evaluate(id=>{const rows=[...document.querySelectorAll('[data-message-id]')];const index=rows.findIndex(x=>x.dataset.messageId===id);window.qa.expand(rows[index-1]?.dataset.messageId||id);},before.id);await assert('height change above viewport',before);
 before=await position();await page.evaluate(id=>{const rows=[...document.querySelectorAll('[data-message-id]')];const index=rows.findIndex(x=>x.dataset.messageId===id);window.qa.resize(rows[index-2]?.dataset.messageId||id);},before.id);await assert('asynchronous resize without parent update',before);
 await page.evaluate(()=>window.qa.threshold());await wait();await page.evaluate(()=>{document.getElementById('scroller').scrollTop=500;});await wait();
 before=await position();await page.evaluate(()=>window.qa.prepend());await assert('virtualization threshold',before);
 console.log('errors',JSON.stringify(errors));if(errors.length)throw new Error('browser errors');await browser.close();
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{ if(browser) await browser.close(); fs.rmSync(output,{recursive:true,force:true}); });
