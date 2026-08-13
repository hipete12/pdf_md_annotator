# AGENTS.md

Electron + Vue 3 + Vuex PDF annotator with Markdown/LaTeX annotations. Plain JS (no TypeScript), webpack builds, no CI config.

## Commands

- `npm run dev` — webpack dev server + Electron with hot reload (scripts/dev-runner.js)
- `npm run build` — webpack production build of **main AND renderer** into `dist/` (required before e2e tests)
- `npm run lint` — ESLint (vue3-recommended; `no-unused-vars` is a warning, not an error)
- `npm run test` — karma unit tests. **Broken in this repo right now**: karma.conf.js uses `reporters: ['mocha']` but `karma-mocha-reporter` is not installed, and `test/unit/markdown.spec.js` imports `renderMath` as a named export that doesn't exist (only exported via `export default`). Don't rely on it; verify via build + manual/e2e checks.
- `npm run test:e2e` — Playwright + Electron; launches `dist/main/main.js`, so run `npm run build` first. In headless containers: `xvfb-run -a`, and the app needs `--no-sandbox` (Playwright arg: `args: [APP_PATH, '--no-sandbox', '--disable-gpu']`). There are no PDF fixtures in the repo — generate one for tests.

## Architecture

- `src/main/main.js` — Electron main process: window, menu, IPC handlers, and the **electron-store** (`pdf-annotator-settings`) that persists settings to disk.
- `src/renderer/` — Vue 3 app. `components/` (PdfViewer, AnnotationBox, MarkdownEditor, SettingsModal), `store/index.js` (Vuex), `utils/markdown.js` (marked + katex + Prism rendering), `styles/main.css` (global styles).
- Annotations are saved as a `.pdfmark` JSON sidecar next to the PDF via `save-pdfmark`/`commit-pdfmark` IPC.

## Markdown rendering — critical gotchas

- **Never "fix" the newline-stripping in `renderMarkdown`** (`src/renderer/utils/markdown.js`): marked emits pretty-printed HTML with literal `\n` between block tags, and the preview container has `white-space: pre-wrap`, so each newline renders as a phantom line box and doubles block spacing (lists/paragraphs/tables). `html.replace(/>\s*\n\s*</g, '><').replace(/\s+$/, '')` after `marked.parse` is load-bearing. It intentionally only touches tag boundaries — newlines inside `<pre>/<code>` text and single spaces between inline elements are preserved.
- **`.markdown-content` rules in `src/renderer/styles/main.css` are dead CSS** — no component uses that class. The live markdown styles are the scoped `:deep()` rules in `MarkdownEditor.vue` (applies to both live preview and view mode). Edit those; mirror values into `.markdown-content` only for consistency.
- `marked` is configured with `breaks: true` — a single newline renders as a line break; paragraph separation comes only from block margins. This is intentional (annotation notes are tight by design).
- Spacing conventions currently in effect: preview `p`/`ul`/`ol` margins `0.25em`, `p:has(+ ul/ol)` drops its bottom margin so a list start matches text line spacing, `li + li { margin-top: -0.1em }` condenses list items, `li p { margin: 0 }` prevents loose-list doubling. Keep this arrangement; it was iterated heavily.

## Settings — dual source

Settings exist in **two places** that must stay in sync:
1. Vuex defaults in `src/renderer/store/index.js` (`state.settings`) — includes `resetToDefaults` in `SettingsModal.vue` (a third copy of the same defaults!)
2. electron-store defaults in `src/main/main.js`

`get-settings` prunes removed legacy keys (e.g. `markdown.listMargin`/`listItemMargin`) so stale persisted values never reach the renderer — if you remove a setting, prune it there too.

## Workflow conventions

- Development branch is `dev` (origin/dev); `main` is release. **Create feature/fix branches off `dev`**, never commit directly to it.
- **Commit frequently — after every feature or fix** — and push to GitHub (origin). Keep changes scoped to the branch.
- Don't stage `.graymatter/` (local tool state, untracked).
- Style: components are Vue 3 `<script setup>`-style Options/SFC mix, plain JS, single quotes, 2-space indent, LF line endings (`.gitattributes` enforces).
