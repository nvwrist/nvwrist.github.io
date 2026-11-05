// Usage: python3 -m http.server 8765 &  then  node .claude/skills/ascii-world/screenshot.mjs <outDir> [width] [height]
let chromium;
try { ({ chromium } = await import('playwright')); }
catch { ({ chromium } = await import('/opt/node22/lib/node_modules/playwright/index.mjs')); }
const out = process.argv[2] || '.', vw = +(process.argv[3] || 1280), vh = +(process.argv[4] || 720);
const b = await chromium.launch({
  executablePath: process.env.CHROMIUM || undefined,
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const p = await b.newPage({ viewport: { width: vw, height: vh }, deviceScaleFactor: 2 });
p.on('pageerror', e => console.log('PAGEERR', e.message));
p.on('console', m => { if (['error', 'warning'].includes(m.type())) console.log('CONSOLE', m.type(), m.text().slice(0, 300)); });
await p.goto('http://localhost:8765/ascii/');
await p.evaluate(() => localStorage.clear());
const clip = { x: vw / 2 - 170, y: vh / 2 - 200, width: 340, height: 300 };
const shot = (n, c) => p.screenshot({ path: `${out}/${n}.png`, ...(c ? { clip } : {}) });
await p.keyboard.press('2'); await p.waitForTimeout(3500); await shot('forest-rain');
await shot('hero-close', true);
await p.keyboard.press('KeyZ'); await p.waitForTimeout(1200); await shot('hero-fine', true);
await p.keyboard.press('KeyV'); await p.waitForTimeout(1500); await shot('raw');
await p.keyboard.press('KeyV'); await p.keyboard.press('KeyZ'); await p.waitForTimeout(800);
await p.keyboard.press('3'); await p.mouse.click(vw * .75, vh * .45); await p.waitForTimeout(2500); await shot('storm-spell');
await p.evaluate(() => __game.enter('dungeon')); await p.waitForTimeout(1500); await shot('dungeon');
await b.close();
