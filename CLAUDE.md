# nvwrist.github.io

Personal site on GitHub Pages, served straight from `main` (no build step in this repo).

## Layout

| Path | What it is | Edit? |
|---|---|---|
| `index.html`, `assets/`, `favicon.svg`, `icons.svg`, `screenshots/` | Portfolio — **built output** of a React/Vite app whose sources live elsewhere. Commits named `Deploy …` replace these files. | **No.** Never hand-edit or regenerate them. |
| `freon/` | FridgeScope — standalone 3D page (single `index.html`). | Yes, self-contained. |
| `ascii/` | ASCII World — browser game (Three.js scene → ASCII shader). See the `ascii-world` skill. | Yes, self-contained. |
| `.nojekyll` | Keeps Pages from running Jekyll. | Keep. |

## Rules

- Every standalone project lives in **its own folder** (`/<name>/index.html`) and must not touch the portfolio files or other folders. See the `standalone-page` skill.
- **No CDN dependencies.** jsDelivr/unpkg are unreliable for the audience (Russia). Vendor libraries into the page's own `vendor/` folder with their license file.
- UI text is in **Russian**. Pages must work on phones (touch controls, `viewport-fit=cover`, safe-area insets) — the owner tests on an iPhone.
- Use relative URLs inside a page (`./game.js`, `./vendor/...`) so the folder works both on Pages and via raw.githack previews.
- Never push to `main` directly: push a branch, the owner merges the PR (merging deploys).
- Preview a branch before merge: `https://raw.githack.com/nvwrist/nvwrist.github.io/<branch>/<folder>/index.html`.

## Testing

No test suite. Verify pages visually in headless Chromium:
- serve the repo: `python3 -m http.server 8765` (ES modules do not load from `file://`);
- WebGL needs software GL flags: `--use-angle=swiftshader --enable-unsafe-swiftshader --ignore-gpu-blocklist`;
- `node .claude/skills/ascii-world/screenshot.mjs <out-dir>` takes the standard ASCII World shots.
FPS in SwiftShader (≈10–20) says nothing about real devices.
