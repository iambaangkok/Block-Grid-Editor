# CLAUDE.md — working agreement for block-grid-editor

Domain language (Assembly / Key Piece / Placement / Unit Cell) and all product decisions live in
[CONTEXT.md](CONTEXT.md). Read it first.

## Git workflow

`master` is **production**: once Cloudflare Git integration is connected, pushing to it builds and
deploys to https://www.iambaangkok.dev/block-grid-editor/. Work on a branch; only commit or push
when the user asks. Before merging: `pnpm build`, `pnpm test`, `pnpm lint` must pass.

## Version

Bump the version on any change to the deployed site, in **two places kept in sync**: `VERSION` in
[src/App.tsx](src/App.tsx) and `"version"` in [package.json](package.json). Semver.

## Layout

- `src/model/` — pure domain logic, no React: `types`, `geometry` (rotate/mirror, cell shapes),
  `analysis` (overlap & fit — the base for future interlock analysis), `workspace` (immutable ops),
  `io` (JSON import/export + validation), `palette`, `shape` (connectivity, cavities), `checks`,
  `fill` (fill search), `lookahead` (dead-end elimination; runs in `src/workers/`).
- `src/state/store.ts` — undo/redo history + localStorage autosave (`commit(fn, { mergeKey })`).
- `src/render/draw.ts` — Canvas 2D renderer (1 unit = 1 cell, +y up).
- `src/components/` — React UI (`AssemblyCanvas`, `PieceCanvas`, `KeyPieceEditor`, …).

## Commands

- `pnpm dev` — dev server at http://localhost:5173/block-grid-editor/
- `pnpm build` — `tsc -b && vite build` → `dist/block-grid-editor/`
- `pnpm test` — vitest · `pnpm lint` — oxlint

## Deploy notes

Served from a **subpath**. Cloudflare Worker with Static Assets (assets-only, [wrangler.jsonc](wrangler.jsonc))
on route `www.iambaangkok.dev/block-grid-editor*`. The route keeps the path prefix, so Vite
`base` is `/block-grid-editor/` and the build lands in `dist/block-grid-editor/` while wrangler
serves `dist/`. Don't change one without the other.
