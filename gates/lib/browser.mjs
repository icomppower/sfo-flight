// Real Chrome for the page gates: a static server for dist/ and a puppeteer-core page with WebGPU on (Metal on the
// M4). Same launch flags as SFO Approach's A4.
import { createServer } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { join, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
export const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.bin': 'application/octet-stream', '.glb': 'model/gltf-binary', '.jpg': 'image/jpeg', '.png': 'image/png', '.wasm': 'application/wasm', '.deflate': 'application/octet-stream', '.ogg': 'audio/ogg', '.mp3': 'audio/mpeg' };

export function serve(dir = join(root, 'dist')) {
  return new Promise((resolve) => {
    const s = createServer((req, res) => {
      let p = decodeURIComponent(req.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html';
      const f = join(dir, p);
      if (!existsSync(f)) { res.statusCode = 404; return res.end(); }
      res.setHeader('Content-Type', MIME[extname(f)] || 'application/octet-stream'); res.end(readFileSync(f));
    });
    s.listen(0, '127.0.0.1', () => resolve({ url: `http://127.0.0.1:${s.address().port}/`, close: () => s.close() }));
  });
}

export async function launch() {
  const puppeteer = (await import('puppeteer-core')).default;
  return puppeteer.launch({ executablePath: CHROME, headless: true, protocolTimeout: 600000, args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan,WebGPU', '--use-angle=metal', '--ignore-gpu-blocklist', '--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
}

// open the page, collect errors, wait for the engine and the flight game
export async function openPage(browser, url, { viewport = { width: 1440, height: 900 }, query = '', touch = false, init = null } = {}) {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e.message || e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('response', (r) => { if (r.status() >= 400) errors.push(`HTTP ${r.status()} ${r.url().replace(url, '/')}`); });
  await page.setViewport({ ...viewport, deviceScaleFactor: 1, hasTouch: touch, isMobile: touch });
  if (init) await page.evaluateOnNewDocument(init);
  await page.goto(url + '?noAudio' + query, { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => window.__app && window.__app.booted, { timeout: 300000 }).catch((e) => { throw new Error('boot timeout; page errors: ' + errors.slice(0, 8).join(' | ')); });
  await page.evaluate(() => document.querySelector('.tw-start')?.click());
  await page.waitForFunction(() => !!window.__sfo, { timeout: 120000 });
  return { page, errors };
}
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
