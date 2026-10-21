// 用无头 Chrome（真实 GPU、真实时间）依次打开网址，等页面里出现 #shot 后把内容打印出来，一行一个。
// 用法：node test/shoot.mjs URL [URL ...]
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9300 + Math.floor(Math.random() * 500);
const prof = mkdtempSync(join(tmpdir(), 'forma-shoot-'));
const chrome = spawn(CHROME, ['--headless=new', '--use-angle=metal', '--force-device-scale-factor=2', '--window-size=900,640',
  '--hide-scrollbars', `--remote-debugging-port=${PORT}`, `--user-data-dir=${prof}`, 'about:blank'], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function wsUrl() {
  for (let i = 0; i < 100; i++) {
    try { const r = await fetch(`http://127.0.0.1:${PORT}/json/version`); return (await r.json()).webSocketDebuggerUrl; } catch (_) { await sleep(100); }
  }
  throw new Error('Chrome 没有启动');
}

const ws = new WebSocket(await wsUrl());
await new Promise(r => ws.addEventListener('open', r, { once: true }));
let seq = 0; const waiting = new Map();
ws.addEventListener('message', ev => { const m = JSON.parse(ev.data); if (m.id && waiting.has(m.id)) { waiting.get(m.id)(m); waiting.delete(m.id); } });
const send = (method, params = {}, sessionId) => new Promise(r => { const id = ++seq; waiting.set(id, r); ws.send(JSON.stringify({ id, method, params, sessionId })); });

for (const url of process.argv.slice(2)) {
  const { result: { targetId } } = await send('Target.createTarget', { url: 'about:blank' });
  const { result: { sessionId } } = await send('Target.attachToTarget', { targetId, flatten: true });
  await send('Emulation.setDeviceMetricsOverride', { width: 900, height: 640, deviceScaleFactor: 2, mobile: false }, sessionId);
  await send('Page.navigate', { url }, sessionId);
  let text = '';
  for (let i = 0; i < 600 && !text; i++) {
    await sleep(100);
    const r = await send('Runtime.evaluate', { expression: "(document.getElementById('shot')||{}).textContent||''", returnByValue: true }, sessionId);
    text = r.result?.result?.value || '';
  }
  process.stdout.write(`${url}\t${text.replace(/\n/g, ' ') || 'TIMEOUT'}\n`);
  await send('Target.closeTarget', { targetId });
}
ws.close(); chrome.kill(); await sleep(300);
try { rmSync(prof, { recursive: true, force: true }); } catch (_) {}
