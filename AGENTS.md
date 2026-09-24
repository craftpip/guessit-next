# guessit-next — Agents Handbook

Centralized media-name classification engine (Node.js / ESM). One implementation of
"extract seasons/episodes/title/type from media file names and folder names" shared by
jellyjake (Node) and jellysort (Python).

## Why this project exists

jellyjake (`/www2/jellyjake`) and jellysort (`/www1/jellysort`) both extract the same
structure from the same kind of inputs, but the code diverged and is maintained twice:

- jellyjake: `src/utils/queryBuilder.js` — `classifyTorrent` + `extractSEFromName`
  (categorization, torrent-name → `collection|season_batch|episode|episode_collection|
  movie|others`).
- jellysort: `app/classification/` (Python) — per-file classification →
  `series|movie|extra|skip` with title/season/episode from file **and** folder names.

Everything name/folder-parse-related moves here. Project-specific logic (jellyjake
ranking/matrix/coverage, jellysort resolver/scan/move) stays in its project.

## Commands

- Test: `npm test` (or `node --test tests/`)
- Lint: `npm run lint` if configured
- Per-name check: `node bin/index.js --json "Show S01E01.mkv"`
- Serve (stdio JSON-lines): `node bin/index.js --serve`

## Language & interfaces

- Language: **Node.js (ESM)**. `package.json` has `"type": "module"`.
- jellyjake consumes in-process: `import { categorize } from 'guessit-next'`.
- jellysort (Python) consumes via the stdio daemon:
  `node bin/index.js --serve --json` — one process per scan, JSON-lines in/out.
- The JSON field contract is the public interface (locked by `tests/cli.test.js`).
  Never break it without a contract update + consumer migration.

## Project Structure

- `src/normalize.js`: name cleaning (separator normalization, lowercase) [jellyjake `normalizeParseName`]
- `src/patterns.js`: merged regex set (both projects) + sane caps/guards
- `src/se.js`: `extractSE` family — S/E extraction (ranges preserved), folder-season,
  bare-episode + codec guards [jellyjake `extractSEFromName` + jellysort `episodes.py`]
- `src/categorize.js`: `categorize(name)` — jellyjake `classifyTorrent` cascade
- `src/classifyFile.js`: `classifyFile(candidate)` — jellysort `classify_candidate`
- `src/kinds.js`: kind vocabulary + extra_type mapping (shared vocab)
- `src/titles.js`: title extraction from file+folder names [jellysort `titles.py`]
- `src/index.js`: public API (`categorize`, `classifyFile`, `extractSE`)
- `bin/index.js`: CLI `--json | --batch | --serve`
- `fixtures/corpus.json`: shared regression corpus (obfuscated)
- `tests/`: categorize (jellyjake registry), se, classifyFile (jellysort genes),
  cli (JSON contract)
- `plans/`: this project's plans

## Project Rules

### Tests first — always

Tests are the FIRST thing we do. Before any implementation lands, the test
registries are written down (ported from consumers, obfuscated per the rule
below). Implementation follows only to make the tests pass: red → green.
No `src/` code lands without a failing-then-passing test behind it.

### Workspace boundary — read-only outside, write only inside

We are only allowed to READ from outside this folder. `jellyjake` (`/www2/jellyjake`)
and `jellysort` (`/www1/jellysort`) are strictly READ-ONLY source material for
lifting/porting code and tests. No changes are ever made outside `/www1/guessit-next`:
we never write, edit, delete, rename, install into, or otherwise modify anything
there. ALL file edits, git commits, and package installs stay inside this project.
This holds for every phase of the plan, including Phase 2/3 consumer integration —
integration changes land here, and any consumer-side change requires explicit
user instruction first.

### Obfuscate real media names

Real series/movie titles and release groups never appear in code, fixtures, commits,
or logs. Use neutral placeholders (`Show Name`, `[RlsGrp]`, `Movie (2020)`). The
corpus (`fixtures/corpus.json`) must keep identical formatting tokens (`SxxEyy`, `v2`,
`REPACK`, years, resolution/codec strings, episode-per-folder counts) so behavior is
unchanged, but all real names are randomized. Never commit a reverse mapping.

### Single source of truth for each regex

If a regex or S/E rule exists in more than one place, that's a bug — move it into
`src/patterns.js` or `src/se.js`. This project exists to kill the duplication.

### Same JSON contract for both consumers

`classifyFile` and `categorize` return plain JSON-serializable objects. Field names
are the interface (`type/title/episode_title/series_alias/year/season/episode/
confidence/reason/extra_type` for file classification; `kind/season/episode/
episodeEnd/seasonRange/seasonList/isCompletePack` for categorization). Any change to
these bytes is a breaking contract change.

### Two vocabularies, one core

- Categorization kinds: `collection | season_batch | episode | episode_collection | movie | others`
- File types: `series | movie | extra | skip`

They are different views of the same parse core. Do not collapse them; do not let the
S/E core drift into either project's domain vocabulary.

## Known Patterns And Fixes

To be filled in as this project's own fixes land. Inherited fixes are documented in
the source provenance notes above (jellyjake's `queryBuilder.js` and jellysort's
`app/classification/` remain the historical reference until Phase 2/3 retire them).

### S/E parsing guards that MUST stay (inherited)

- Season cap 1..60, episode cap 1..500; 4-digit values are years/resolutions and never
  become season/episode numbers.
- x-notation `1x05` requires season ≤ 60 (kills `1920x1080`) and episode ≠ 264/265
  (kills `1 x264` codec tails), plus lookbehind guards `(?<![\d.])(?<!\d )`.
- Range ends must pass a sanity check: `saneRangeEnd` (< 4 digits) + `(?!\w)`
  token-glue guard (`Season 1 - 720p` is a season batch, never `[1,720]`).
- Anime finale `S2 - 12 END` is S02E12 (episode), never a season range.
- `S01 1-2` means S01E01..S01E02 (episode_collection), not a season batch.
- `Part N - <num>` with a season anchor is an episode designator; bare `Part N`
  (no dash-number) is a part pack.
- Bare `complete` (with no season/movie signals) → complete pack.
- Codec decimals (`Opus 2.0`, `DDP2.0`) must never be treated as decimal episodes.