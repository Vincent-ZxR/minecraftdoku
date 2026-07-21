# minecraftdoku

Small Minecraft-themed puzzle app built with React + Vite + Tailwind.

This README is a handover guide so a new chat session can add features quickly and safely.

## What The App Does

- Displays a 3x3 logic grid.
- Each row and column has one criterion.
- A block is valid in a cell only if it matches both row and column criteria.
- A block cannot be used twice in the same grid.
- Player loses after 3 errors.
- On loss, clicking a cell opens all valid answers for that cell.
- Puzzle generation enforces at least 3 possible answers per cell.

## Core Rules To Preserve

- Grid size is fixed to 3x3.
- Error budget is fixed to 3 unless intentionally changed.
- Generator must keep these 4 properties exactly once across the 6 criteria:
	- hardness
	- blast_resistance
	- emits_power
	- material_is_opaque
- Remaining criteria are currently name-based contains rules.
- Minimum per-cell candidate count is 3.

If you change generation logic, validate these invariants before merging.

## Seed Behavior

- The active puzzle is always today's seed in UTC format YYYY-MM-DD.
- Example: ?seed=2026-07-21
- Everyone gets the same grid for that day.
- The app keeps seed in URL query parameter seed for shareability.
- If the URL contains another seed, gameplay still normalizes to today's seed.
- Header controls include:
	- daily seed display
	- copy seed link button

## Local Progress Cache

- Player progress is cached in localStorage per day seed.
- Cache includes grid placements, error count, game state, and feedback message.
- Reopening the same daily link restores the previous in-progress state.
- Daily cache is validated before restore (invalid or stale data is ignored safely).

## Project Map

- src/App.jsx
	- Main gameplay state, puzzle generation, UI, seed URL sync.
- src/lib/blockDataSchema.js
	- Whitelist of puzzle properties and schema metadata.
- src/lib/blockDataNormalizer.js
	- Normalizes heterogeneous source values into canonical scalar values.
- public/data/block_data_1.12.json
	- Local authoritative dataset used by the app.
- public/assets/img/BlockCSS2.png
	- Sprite sheet for block icons.
- vercel.json
	- SPA rewrite config for Vercel.
- netlify.toml
	- SPA redirect config for Netlify.

## Important Constants

Defined in src/App.jsx:

- GRID_SIZE = 3
- MAX_ERRORS = 3
- MIN_POSSIBLE_ANSWERS_PER_CELL = 3
- MIN_CRITERION_MATCHES = 18
- MAX_GRID_GENERATION_ATTEMPTS = 12000
- Each grid samples 6 unique clue groups at random.
- The clue pool includes hardness, blast_resistance, emits_power, material_is_opaque, material_blocks_movement, material_is_liquid, material_is_solid, material_is_burnable, suffocates_mobs, material, name_contains, name_starts_with, and name_ends_with.

## Local Development

### Native Node

1. Install Node 20 or newer.
2. Run:

```bash
npm install
npm run dev
```

### Docker (Windows-friendly fallback)

If npm is unavailable on host:

```bash
docker run --rm -it -p 5173:5173 -v "${PWD}:/app" -w /app node:24-slim sh -lc "npm install && npm run dev -- --host 0.0.0.0 --port 5173"
```

For production build validation:

```bash
docker run --rm -v "${PWD}:/app" -w /app node:24-slim sh -lc "npm ci && npm run build"
```

## Build And Preview

```bash
npm run build
npm run preview
```

## Deploy

### Vercel

1. Import repository.
2. Framework preset: Vite.
3. Build command: npm run build.
4. Output directory: dist.
5. Deploy.

vercel.json already handles SPA rewrites.

### Netlify

1. Import repository.
2. Build command: npm run build.
3. Publish directory: dist.
4. Deploy.

netlify.toml already handles SPA redirects.

## How To Add A New Feature Safely

Use this sequence to avoid regressions:

1. Define feature scope in one sentence.
2. Identify if it touches:
	 - generation
	 - validation
	 - seed behavior
	 - UI only
3. Keep edits minimal and isolated by file responsibility.
4. Run quick manual checks listed below.
5. Build production before shipping.

## Manual Regression Checklist

Run this after any non-trivial change:

1. App loads dataset without crash.
2. Grid renders with 3 row clues and 3 column clues.
3. Empty cells display possible answer counts.
4. Wrong answer increases error count and explains why.
5. Duplicate block is rejected.
6. Loss occurs on 3rd error.
7. After loss, clicking a cell shows valid answers.
8. Seed in URL reproduces same puzzle on refresh.
9. Copy seed link produces shareable URL.
10. Production build succeeds.

## Adding New Puzzle Properties

When adding a new rule property, update in this order:

1. src/lib/blockDataSchema.js
	 - Add property schema with correct kind and operators.
2. src/lib/blockDataNormalizer.js
	 - Ensure raw values normalize cleanly to one scalar value.
3. src/App.jsx
	 - Extend buildCriterionPool and labels.
	 - Decide whether property is required or optional in generator.
4. Re-run generation checks
	 - Confirm minimum candidate count still passes.
	 - Confirm no dead cells.

## Known Pitfalls

- Dataset values are heterogeneous and sometimes mixed types.
- Avoid using non-normalized raw properties directly in game logic.
- Too-strict criteria combinations can produce impossible or near-empty cells.
- On Windows, Docker Desktop engine must be running before docker commands.

## Suggested Prompt For Next Chat

Use this to onboard a new assistant quickly:

"Read README first. Preserve generator invariants. I want to add FEATURE_NAME. Propose minimal edits, then implement and run build validation."
