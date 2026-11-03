/* 通过 CDP 驱动无头 Chrome，真实点击/调用页面逻辑，收集控制台错误 */
const { spawn } = require('child_process');
const http = require('http');

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9333;
const ROOT = 'file:///D:/%E4%BD%8E%E4%BB%A3%E7%A0%81/%E8%8B%B1%E8%AF%AD%E4%B8%80%E5%AF%B9%E4%B8%80%E6%95%99%E5%AD%A6%E8%BD%AF%E4%BB%B6/prototype/';

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function getJSON(path) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port: PORT, path }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => resolve(JSON.parse(d)));
    }).on('error', reject);
  });
}

class Page {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); this.errors = []; this.logs = []; }

  static async open() {
    const list = await getJSON('/json/list');
    let target = list.find(t => t.type === 'page');
    if (!target) target = await getJSON('/json/new?about:blank');
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
    const p = new Page(ws);
    ws.onmessage = ev => {
      const msg = JSON.parse(ev.data);
      if (msg.id && p.pending.has(msg.id)) { p.pending.get(msg.id)(msg); p.pending.delete(msg.id); return; }
      if (msg.method === 'Runtime.exceptionThrown') {
        const d = msg.params.exceptionDetails;
        p.errors.push((d.exception && (d.exception.description || d.exception.value)) || d.text);
      }
      if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
        p.logs.push(msg.params.args.map(a => a.value || a.description || '').join(' '));
      }
    };
    p.send('Runtime.enable');
    p.send('Page.enable');
    return p;
  }

  send(method, params) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params: params || {} }));
    return new Promise(res => this.pending.set(id, res));
  }

  async goto(url) {
    await this.send('Page.navigate', { url });
    await sleep(700);
  }

  async eval(expr) {
    const r = await this.send('Runtime.evaluate', {
      expression: `(function(){ ${expr} })()`,
      returnByValue: true, awaitPromise: true
    });
    if (r.result && r.result.exceptionDetails) {
      const d = r.result.exceptionDetails;
      throw new Error((d.exception && d.exception.description) || d.text);
    }
    return r.result && r.result.result ? r.result.result.value : undefined;
  }

  async text(sel) {
    return this.eval(`var e=document.querySelector(${JSON.stringify(sel)});return e?e.textContent.trim():null;`);
  }

  /* 整页截图（输出到 _test/shots/） */
  async shot(name) {
    const fs = require('fs');
    const path = require('path');
    const m = await this.send('Page.getLayoutMetrics');
    const w = Math.ceil(m.result.cssContentSize.width);
    const h = Math.ceil(m.result.cssContentSize.height);
    const r = await this.send('Page.captureScreenshot', {
      format: 'png', captureBeyondViewport: true,
      clip: { x: 0, y: 0, width: w, height: Math.min(h, 4200), scale: 1 }
    });
    const dir = path.join(__dirname, 'shots');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir);
    const file = path.join(dir, name + '.png');
    fs.writeFileSync(file, Buffer.from(r.result.data, 'base64'));
    return file;
  }

  close() { try { this.ws.close(); } catch (e) {} }
}

async function launch() {
  const proc = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
    '--remote-debugging-port=' + PORT,
    '--user-data-dir=' + require('os').tmpdir() + '/ee-cdp-profile-' + Date.now(),
    '--window-size=1440,1000', 'about:blank'
  ], { stdio: 'ignore' });
  for (let i = 0; i < 40; i++) {
    try { await getJSON('/json/version'); return proc; } catch (e) { await sleep(250); }
  }
  throw new Error('chrome 启动失败');
}

module.exports = { Page, launch, sleep, ROOT };
