---
name: standalone-page
description: Add or change a self-contained page on nvwrist.github.io (like /freon or /ascii) without touching the built portfolio. Use when asked to create a new demo/page/game on the site or to publish one at a /path.
---

# Standalone page on nvwrist.github.io

The site root is the **built** portfolio (React/Vite output from another repo). New work goes into its own folder.

## Steps

1. Create `/<slug>/index.html` (lowercase slug = the URL path). Put JS/CSS next to it (`/<slug>/app.js`) or inline.
2. Head boilerplate used across the site:
   - `<html lang="ru">`, `<meta charset="utf-8">`
   - `<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no,viewport-fit=cover">`
   - `<link rel="icon" type="image/svg+xml" href="/favicon.svg">`
   - a Russian `<title>` and `<meta name="description">`
3. Libraries: copy the exact build into `/<slug>/vendor/` with its LICENSE (e.g. `npm pack three@0.160.0`, take `build/three.module.min.js`). No CDN links.
4. Relative paths only inside the folder.
5. Mobile: `touch-action:none` on canvases, on-screen buttons for every keyboard action, `@media (hover:none)` to hide keyboard hints, safe-area insets.
6. Check `git diff --stat origin/main` touches only `/<slug>/` (plus docs if intended).
7. Verify in headless Chromium (see CLAUDE.md → Testing), look at the screenshots.
8. Commit on a branch, push, give the owner the raw.githack preview link; the owner merges the PR to publish at `https://nvwrist.github.io/<slug>/`.
