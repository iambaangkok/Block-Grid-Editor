# block-grid-editor — domain & decisions

A visual, grid-based editor for building **Interlocking Puzzle** configurations (research into
undecidability). Web SPA, live at `https://www.iambaangkok.dev/block-grid-editor/`.

## Ubiquitous language

- **Assembly** — a named, square 2D grid on which **Key Piece placements** sit. Coordinates:
  `(0,0)` at the centre, `+x` right, `+y` up. Working bounds 128×128 (`x, y ∈ [-64, 63]`) for now;
  the model treats the grid as unbounded. Many assemblies; all persisted to localStorage.
- **Key Piece** — a named template: a set of **Unit Cells** at integer offsets, plus one **border
  colour** and one **fill colour** shared by every cell in it. Owned by one assembly; can be
  *copied* (independent duplicate) to another assembly.
- **Placement** — an instance of a Key Piece on an assembly: position + rotation (0/90/180/270) +
  mirror flag. Linked to its template — editing the Key Piece updates every placement live.
  Only placements go on an assembly (no loose cells).
- **Unit Cell** — one grid cell inside a Key Piece. Has a **kind** and (except `block`) a
  **direction** (the edge its feature sits on: N/E/S/W), rotatable in 90° steps.

### Unit Cell kinds

| kind | look |
|---|---|
| `block` | full square (not rotatable) |
| `spike` | no block — a triangle on one edge; its base is inset from the edge's ends (never the full edge, so four spikes don't tile a square), apex at the centre |
| `hole` | full block with a matching triangular notch cut in from one edge |
| `spike2` / `spike3` / `spike4` | no block — 2 / 3 / 4 smaller spikes side by side on the **same** edge (edge split into equal slots, each spike inset in its slot; depth min(½, 1/n)) |
| `hole2` / `hole3` / `hole4` | block with the matching 2 / 3 / 4 notches on one edge |

### Overlap & fit

Placements may overlap. Per occupied grid cell, the resolved cells are classified:
- **fit** — a spike cell in the hole cell with the same count (`spikeN` in `holeN`), same edge, so the triangles land exactly in the notches → shown as a valid
  interlock indicator.
- **conflict** — any other overlap (block/block, spike into solid, mismatched spike/hole such as `spike` into `hole2`) →
  red warning.

The classification is a pure function over the assembly model, so later analysis (lock checks,
sliding/disassembly simulation) can build on the same data.

## Key-piece checks

Every key piece is checked live (results in the Key Piece editor's **Checks** section, a `!` badge
in the pieces list, and evidence drawn on the editor grid). Implemented in `src/model/checks.ts`.
For connectivity and notches every unit cell counts as a **full square** whatever its kind;
cavities also look at the empty space inside unseated spike/hole cells (below). Adjacency is by
**shared edges only** (corner contact connects nothing).

1. **Edge-connected** — all cells form one edge-connected group. A check, not an editor
   restriction (pieces are briefly disconnected while drawing).
2. **No enclosed cavity** — all empty space reaches the outside through edges. A diagonal corner
   gap does not count as an opening. Empty space is tracked per square, including space inside
   occupied squares:

   | square holds | its empty space opens onto |
   |---|---|
   | nothing | all 4 edges |
   | block, or a seated spike/hole pair | — (solid) |
   | a lone hole cell (`hole`…`hole4`) | only its notch edge |
   | unseated spike cell(s) | all 4 edges (bases are inset, so the base edge has open strips) |

   Space crosses between neighbouring squares only where both sides are open on the shared edge.
   So an **unpaired hole** whose notch faces into the piece, or an **unpaired spike** walled in on
   every side, is an enclosed cavity.
3. **Cannot fill its own concave** — n/a unless 1 and 2 pass.

Terms used by check 3:

- **Notch** — a maximal run of empty cells in one row (or column) with a piece cell directly at
  both ends. One cell is enough.
- **Concave** — a stack of parallel notches in consecutive rows (or columns), each overlapping
  the next. A single notch is a concave of depth 1. Its **innermost notch** is the end backed by
  the piece (the whole line beyond it, across its span, is piece); the other end is the mouth.
- **Solid square** — a square holding a `block`, or a spike seated in its matching hole
  (same count, same edge). A lone spike or a lone hole is not solid.
- **Filled concave** — every square of its innermost notch is solid.
- **Gap** — an enclosed cavity (same rule as check 2, including unpaired spikes/holes) in the
  piece plus the copies placed to fill it. A fill must not trap a gap; arrangements that do are
  rejected.

Check 3 **fails if any one concave can be filled** by copies of the piece (unlimited copies, any
rotation/mirror), placed statically (no insertion path required), not overlapping the original
or each other under the grid's overlap rules (only seated spike/hole pairs share a square),
and without trapping a gap.
Concaves are tested independently.

Decidability: only copies with a cell on the innermost notch can help, so the candidates are
finite (≤ 8 orientations × piece cells × notch cells); a backtracking search decides it. A step
budget guards the UI — if hit, the check reports **unknown** instead of guessing. On failure the
editor shows the concave (orange) and one witness arrangement of copies (dashed).

## Fill candidates

Not a check — a search tool in the Key Piece editor (**Fill candidates** section). Implemented in
`src/model/fill.ts`; check 3 runs on the same engine.

- For the open key piece (the **target**, fixed in place), for each concave, list the
  **arrangements** of filler pieces that make every square of its innermost notch solid. Same
  filling rules as check 3 (static placement, grid overlap rules, solid = block or seated
  spike/hole pair, no trapped gap). Needs the target to be edge-connected with no enclosed cavity.
- **Fillers**: every key piece in the assembly whose **use as filler** toggle is on (the target
  included), unlimited copies each, any rotation/mirror. The toggle is saved on the piece as
  `filler: false` (absent = on), so it persists, exports, and undoes; it's switched with the key
  icon in the key-pieces list.
- **Arrangement** = a distinct set of placed copies; ones producing identical cells count once.
  Only copies with a cell on the innermost notch take part, and each is necessary (a solid square
  admits nothing else). Listed fewest copies first.
- **Cap**: 5 arrangements per concave by default, selectable 5 / 10 / 15 / 20 (remembered in
  localStorage), then "limit reached". A step budget may end the search early — whatever was found
  is kept and "search limit reached" is shown.
- **Live**: recomputed when the target, any filler's cells, a toggle, or the cap changes (cached on
  that geometry, so renames/recolours don't re-run it).
- Concaves are numbered top-to-bottom, left-to-right by their innermost notch and labelled with the
  direction their mouth opens. Hovering one outlines it; hovering an arrangement previews its copies
  on the editor grid in each filler's own colours, and clicking pins that preview.

## Look-ahead (dead-end elimination)

On-demand filter for the Fill candidates list. Originally proposed as a one-step check, with
reference source kept locally in `.scratch/` (not committed); generalised here. Her Assembly 2
pieces are the regression fixture `src/model/fixtures/assembly2.json`. Implemented in
`src/model/lookahead.ts`, run in a Web Worker (`src/workers/lookahead.worker.ts`).

- **Run on demand**: a **Look-ahead** control (1 / 2 / 3 steps, default 1, remembered in
  localStorage) with a **Run** button in the Fill candidates section. Runs in the background with
  progress and **Cancel**; the editor stays usable. Notice shown: it may take a while, and the real
  puzzle might need more steps, but deeper searches take a long time, so it is limited to 3.
- **Merged shape**: the target plus a candidate's copies, every cell kept (a square can hold a
  seated pair or two unseated spikes on different edges).
- **Survival** *(to confirm with her — Q2)*: after placing the candidate, every **new or changed**
  concave must have at least one fill that itself survives the remaining steps;
  `survives(shape, N) = ∀ new/changed concave c ∃ fill f of c: survives(shape + f, N − 1)`,
  `survives(·, 0) = true`. Concaves are examined one at a time.
- **New or changed** *(to confirm with her — Q3)*: a concave counts only if no concave with the same
  notches existed in the shape before that fill. So a concave the target already had (e.g. one
  nothing can fill) doesn't eliminate candidates for its other concaves.
- **Eliminated only on proof**: a candidate is a dead end only when the failure is proven. If a
  sub-search runs out of its step budget (`LOOKAHEAD_BUDGET` = 200 000) or the branching cut-off
  (`LOOKAHEAD_BRANCH` = 20 fills tried per concave) leaves fills untried, the verdict is **unknown**
  and the candidate stays, marked `?`. Proven survivors are marked `✓ N`.
- **Refill**: per concave, candidates are checked fewest copies first until `cap` survivors (✓ or ?)
  are found or `LOOKAHEAD_CEILING` × cap (5×) have been checked; "limit reached" if more remain.
- **Eliminated rows** are grouped (struck through) with the first-step culprit, by shape not
  number: `new concave · opens N · 2 cells: no fill` or `…: every fill dead-ends within k steps`.
  Hovering previews the candidate and outlines the culprit concave in red.
- **Out of date**: results are kept after edits to the piece, fillers, toggles, cap or depth but
  greyed with "Out of date — re-run"; cancelling keeps the previous result.
- **Scope**: affects the candidates list only — check 3 and the badges are unchanged.

Future improvements (not in v0.4.0):
- Walk one concrete failing chain for a deep elimination ("fill with X → then this concave has no
  fill"), stepping through it on the grid.
- Deeper / unlimited look-ahead (the full "can this piece be closed up" question).

## Decisions

- Stack: pnpm, Vite, React 19, TypeScript, Tailwind 4, Canvas 2D rendering, vitest, oxlint
  (mirrors `tweet-typer`).
- Input: desktop mouse + touch (pointer events, pinch-zoom, pan).
- Infinite pan/zoom canvas, white background, light grid lines, axes through origin.
- Editing: select / box-select / move / rotate (→ / ← or R / Shift+R) / mirror (F) / duplicate /
  delete; Shift+Arrow nudges; copy / cut / paste (Ctrl+C / X / V — in-app clipboard, pastes at the
  pointer, works across assemblies by copying the key pieces along); undo/redo (Ctrl+Z / Ctrl+Shift+Z).
- Key Piece editor: separate panel with its own small grid; place cells freely, rotate cells in
  90° steps; mirror whole piece.
- Colours: per Key Piece — border + fill only, no stroke width. Excalidraw-style palette
  (~12 hues × 5 shades) plus quick defaults (yellow, bright green, pink, red, blue, orange,
  purple, black). No free hex picker.
- Persistence: autosave everything to localStorage. Export/import JSON (single assembly or whole
  workspace). PNG export of an assembly, and of all its key pieces in one
  labelled row.
- Deploy: **subpath** `https://www.iambaangkok.dev/block-grid-editor/`. Cloudflare Worker with
  Static Assets (assets-only, no script) bound by a **route** `www.iambaangkok.dev/block-grid-editor*`
  in `wrangler.jsonc`. Routes don't strip the prefix, so Vite `base: '/block-grid-editor/'` and the
  build emits into `dist/block-grid-editor/` (assets dir = `dist`). `www` needs a proxied DNS record
  (none exists yet — e.g. `AAAA www 100::`, proxied). Git integration auto-deploys on push to `master`.

## Out of scope (v1)

- Interlock / undecidability analysis (data model is designed to support it later).
- YAML export, stroke widths, free colour picker.
