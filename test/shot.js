// Headless smoke test: load BLINK, wait for frames, capture console errors and screenshots.
// Runs inside the Playwright container with --network=host.
const { chromium } = require('playwright');
const base = process.env.BASE || 'http://127.0.0.1:8790/';
const views = (process.env.VIEWS || '#m=3iatlas,#m=vesta,#m=planet9,#m=mira,#ra=156.093&dec=-41.6468').split(',');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const errors = [], logs = [];
  page.on('console', m => { const t = `${m.type()}: ${m.text()}`; logs.push(t); if (m.type() === 'error') errors.push(t); });
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('requestfailed', r => errors.push('requestfailed: ' + r.url() + ' ' + (r.failure()?.errorText || '')));
  for (const v of views) {
    const t0 = Date.now();
    await page.goto(base + v, { waitUntil: 'domcontentloaded' }); await page.reload({ waitUntil: 'domcontentloaded' });
    // wait until the status says N frames or an error shows (max 90 s)
    let statusText = '';
    for (let i = 0; i < 90; i++) {
      await page.waitForTimeout(1000);
      statusText = await page.$eval('#tmStatus', el => el.textContent).catch(() => '');
      if (/frames ·|failed|No frames|did not cover|No SPHEREx/.test(statusText)) break;
    }
    const hud = await page.$eval('#hudIdx', el => el.textContent).catch(() => '');
    const det = await page.$eval('#detectCount', el => el.textContent).catch(() => '');
    console.log(`[${v}] ${((Date.now() - t0) / 1000).toFixed(1)}s status="${statusText}" hud="${hud}" detections=${det}`);
    const cls = await page.$eval('#aladin .aladin-container > *', els => els.map(e => e.className).filter(Boolean)).catch(() => []);
    console.log('   aladin children:', JSON.stringify(cls).slice(0, 400));
    const name = v.replace(/[^a-z0-9]+/gi, '_');
    await page.screenshot({ path: `/work/shot${name}.png` });
    // difference mode screenshot
    await page.click('#modeSeg button[data-mode=diff]').catch(() => {});
    await page.waitForTimeout(4000);
    await page.screenshot({ path: `/work/shot${name}_diff.png`, fullPage: true });
    const detText = await page.$eval('#detectList', el => el.innerText.replace(/\n+/g, ' | ').slice(0, 600)).catch(() => '');
    console.log('   detections:', detText);
    const detDiff = await page.$eval('#detectCount', el => el.textContent).catch(() => '');
    console.log(`   diff mode detections=${detDiff}`);
  }
  // mobile layout check
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(base + '#m=vesta', { waitUntil: 'domcontentloaded' }); await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(9000); await page.screenshot({ path: '/work/shot_mobile.png', fullPage: true });
  console.log('--- console errors:', errors.length); errors.slice(0, 20).forEach(e => console.log('  ', e.slice(0, 300)));
  console.log('--- last logs:'); logs.slice(-8).forEach(l => console.log('  ', l.slice(0, 200)));
  await browser.close();
})().catch(e => { console.error('FATAL', e); process.exit(1); });
