// Иконки библиотеки: python3 -m http.server 8123 (в viewer/) → node viewer/tools/make_thumbs.mjs → models/lib/thumbs/<n>.png
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import fs from 'fs'; import path from 'path'; import { fileURLToPath } from 'url';
const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'models', 'lib', 'thumbs');
fs.mkdirSync(OUT, { recursive: true });
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
const p = await b.newPage();
p.on('console', (m) => { if (m.type() === 'warning' || m.type() === 'error') console.log(m.text()); });
await p.goto('http://localhost:8123/tools/thumbs.html');
await p.waitForFunction(() => window.ready);
const n = await p.evaluate(() => window.sheetCount());
for (let i = 0; i < n; i++) {
  const url = await p.evaluate((i) => window.renderSheet(i), i);
  fs.writeFileSync(path.join(OUT, i + '.png'), Buffer.from(url.split(',')[1], 'base64'));
  console.log('лист', i + 1, 'из', n);
}
await b.close();
