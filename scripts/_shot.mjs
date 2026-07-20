import puppeteer from 'puppeteer';
const [url, shot] = process.argv.slice(2);
const b = await puppeteer.launch({ headless: 'shell', args: ['--enable-unsafe-swiftshader', '--no-sandbox'] });
const p = await b.newPage();
await p.setViewport({ width: 1400, height: 1000 });
await p.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
await new Promise(r => setTimeout(r, 9000));
await p.screenshot({ path: shot });
await b.close();
