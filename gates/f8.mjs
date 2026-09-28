// F8 Look (advisory): stills for a human to judge — the C172 over the Golden Gate at golden hour, the 777 flight deck
// on short final 28R at night, the landing-score screen after an autoland, and a phone frame. Written to .verify/f8/.
// --negative: a page that never boots its game must fail.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { root, gate } from './lib/common.mjs';
import { serve, launch, openPage, sleep } from './lib/browser.mjs';

const out = join(root, '.verify/f8');
async function stills(fx = {}) {
  const fail = [];
  mkdirSync(out, { recursive: true });
  execFileSync('npx', ['vite', 'build'], { cwd: root, stdio: 'ignore' });
  const srv = await serve(), br = await launch();
  try {
    const shot = async (name, query, vp, act) => {
      let page = null, errors = [];
      try {
        ({ page, errors } = await openPage(br, srv.url, { query: (fx.broken ? '&game=nosuchgame' : '') + query, viewport: vp || { width: 1600, height: 900 }, touch: !!(vp && vp.width < 600) }));
        await page.waitForFunction(() => window.__sfo && window.__sfo.state === 'flying', { timeout: 30000 });
        if (act) await act(page); else await sleep(5000);
        await page.screenshot({ path: join(out, name + '.png') });
        console.log(`  ${name}.png`);
        const e = errors.filter((x) => !/favicon/.test(x)); if (e.length) fail.push(`${name}: ${e[0]}`);
      } catch (e) { fail.push(`${name}: ${e.message.split('\n')[0]}`); } finally { if (page) await page.close(); }
    };
    await shot('c172-golden-gate-golden-hour', '&ac=c172&start=ggb&time=golden&cam=chase&wx=calm');
    await shot('b777-cockpit-short-final-28R-night', '&ac=b77w&start=final3&rwy=28R&time=night&cam=cockpit&wx=calm');
    await shot('landing-score', '&ac=b77w&start=final3&rwy=28R&time=day&cam=chase&wx=westerly', null, async (page) => {
      await page.evaluate(() => { const g = window.__sfo, E = g.tools.AP_EVENT; const q = [E.AP, E.AT, E.APP]; const t = setInterval(() => { if (!q.length) return clearInterval(t); g.pending = q.shift(); }, 200); g.mcp.spd = 154; });
      await page.waitForFunction(() => document.querySelector('.sf-result .sf-grade'), { timeout: 300000 });
      await sleep(500);
    });
    await shot('phone-390x844', '&touch&lang=zh&ac=c172&start=final3&rwy=28R&time=golden&cam=chase&wx=calm', { width: 390, height: 844 });
  } finally { await br.close(); srv.close(); }
  return fail;
}
await gate('F8', () => stills(), [['game never boots', () => stills({ broken: true })]]);
