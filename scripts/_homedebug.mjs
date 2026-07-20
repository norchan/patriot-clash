import puppeteer from 'puppeteer';
const url = process.argv[2] || 'https://politicsgo.app/battlemap';
const b = await puppeteer.launch({ headless: 'shell', args: ['--enable-unsafe-swiftshader', '--no-sandbox'] });
const p = await b.newPage();
const logs = [];
p.on('console', m => logs.push(`[${m.type()}] ${m.text().slice(0, 220)}`));
p.on('pageerror', e => logs.push(`[pageerror] ${String(e).slice(0, 300)}`));
p.on('response', r => { if (r.url().includes('mapbox.com')) logs.push(`[net ${r.status()}] ${r.url().slice(0, 130)}`); });
await p.setViewport({ width: 1400, height: 1000 });
await p.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
await new Promise(r => setTimeout(r, 8000));
const info = await p.evaluate(() => {
  const c = document.querySelector('.mapboxgl-map canvas');
  const box = c?.parentElement?.parentElement;
  return {
    canvasAttr: c ? [c.width, c.height] : null,
    canvasCss: c ? [c.clientWidth, c.clientHeight] : null,
    containerCss: box ? [box.clientWidth, box.clientHeight] : null,
    webgl2: (() => { try { return !!document.createElement('canvas').getContext('webgl2') } catch { return false } })(),
  };
});
console.log('INFO', JSON.stringify(info));
for (const l of logs.slice(0, 40)) console.log(l);
await b.close();
