# guessit-next — Centralized Media-Name Classification

## Goal

Create a standalone, language-independent classification engine for media file names
and folder names. It replaces the duplicated, divergent classification code that
currently lives in two projects:

- **jellyjake** (`/www2/jellyjake`, Node.js) — `classifyTorrent` + `extractSEFromName`
  + regex helpers in `src/utils/queryBuilder.js` (categorization: one torrent name →
  `collection|season_batch|episode|episode_collection|movie|others`, plus
  `season/episode/episodeEnd/seasonEnd/seasonRange/seasonList/isCompletePack/_part`).
- **jellysort** (`/www1/jellysort`, Python) — `app/classification/` (`patterns.py`,
  `episodes.py`, `kinds.py`, `titles.py`, `classifier.py`) layered on the pip `guessit`
  package (per-file classification: `series|movie|extra|skip`, title/episode_title/
  series_alias/year/confidence/reason/extra_type, folder-hierarchy title logic).

Both projects extract the **same kind of information** (seasons, episodes, series,
type) from the **same kind of inputs** (media file names and folder names), but the
implementations have diverged and are maintained independently. This project
centralizes that logic so there is exactly **one** implementation, **one** regression
registry, and **one** package both projects consume.

## Guiding principles

These are the non-negotiables that came out of the design discussion. The plan below
implements them; if a step contradicts them, the step is wrong.

1. **There is NO dual implementation. Ever.** The classification code is *removed*
   from both consumers completely. jellysort keeps **zero** classification logic; its
   `app/classification/` Python is deleted, not kept alongside. jellyjake keeps **zero**
   regex/parse logic; `classifyTorrent`/`extractSEFromName` become calls into this
   package. There is no "fallback path where it's unavoidable" — every classification
   question in both projects goes through guessit-next, 100% of the time.
2. **The "bridge" is just how a consumer uses the package, not a special case.**
   jellyjake (Node) consumes in-process via `import`. jellysort (Python) consumes via
   the stdio daemon. Both are ordinary consumer interfaces; neither is a place where
   duplicate logic may hide.
3. **This package owns *everything* that extracts structure from file/folder names** —
   seasons, episodes, ranges, titles, series, type, extras. That is the shared core.
   Project-specific logic that isn't about parsing names (jellyjake ranking/matrix/
   coverage, jellysort resolver/scan/move) stays where it is.
4. **Tests first, always.** Test registries are written down (ported, obfuscated)
   before any implementation; `src/` only lands to make them green (red → green).
5. **Workspace boundary.** Outside folders are read-only source material. Consumers are
   never modified without explicit user instruction, including in Phase 2/3.

## Language decision

**Node.js is the source of truth.** Key reasons:

- jellyjake is Node.js — an in-process `require()` gives it native-speed usage with
  zero subprocess overhead.
- guessit-the-pip-package is Python, but this project is NOT a fork of guessit; it is
  a fresh, self-contained implementation. Since classification is pure regex + logic
  (no heavy Python/C dependencies), Node.js is the right host.
- jellysort (Python) consumes the Node package through a **stdio interface**
  (`node bin/index.js --serve --json`, one daemon process per scan, JSON-lines
  protocol). See [Interfaces](#interfaces).

## Scope of the shared package

"Classification" here means: **anything that has to do with extracting structure from
media file names and folder names** — seasons, episodes, title, series, type, extras.
Everything name/folder-related is owned by guessit-next. Project-specific logic that
is not about parsing names stays in its project:

- jellyjake's `scoreResult`, `falsePositiveScore`, `analyzeSeriesResults`,
  `buildSeriesPreference`, `classifySeasonCoverage`, `classifySeriesCoverage`, search
  matrix, ranking, season-picker — **stays in jellyjake**.
- jellysort's `resolver`, `scan_orchestrator`, `scan_manager`, move/confirm logic —
  **stays in jellysort**.

Only the name/folder parsing core moves here — but that core moves **entirely**.
Nothing name/folder-parse-related remains in either consumer.

## Package structure

```
/www1/guessit-next/
  package.json          name: guessit-next, type: module, exports map, scripts
  src/
    normalize.js        name cleaning (separator normalization, lowercase)  [from jellyjake normalizeParseName]
    patterns.js         the merged regex set (both sides) + sane caps/guards  [episodes/patterns.py + queryBuilder regexes]
    se.js               extractSEFromName family + folder-season + bare-episode + codec guards  [jellyjake + jellysort episodes.py]
    categorize.js       classifyTorrent cascade (torrent-name → item category)  [from jellyjake queryBuilder.js]
    classifyFile.js     classifyCandidate (file → series/movie/extra/skip + titles)  [ported from jellysort classification/]
    kinds.js            kind vocab + extra_type mapping (shared by both layers)
    titles.js           title extraction from file+folder names  [ported from jellysort titles.py]
    index.js            public API: categorize(name), classifyFile(candidate), extractSE(name)
  bin/index.js          CLI: --json <name> | --batch | --serve (stdio JSON-lines)
  scratch/corpus.json   user-maintained regression corpus (never committed; gitignored)
  tests/
    categorize.test.js  jellyjake tests/classify.test.js registry (~120 entries) — moved, not copied
    se.test.js          jellyjake SE registry + jellysort JellyJake-ported cases
    classifyFile.test.js jellysort test_classifier.py + corpus regression, ported to JS
    cli.test.js         JSON-contract tests for the CLI/serve interface
  README.md
  AGENTS.md
  plans/
```

## Interfaces

### categorize(name) → CategoryResult

```json
{
  "kind": "episode_collection",
  "season": 1, "episode": 1, "episodeEnd": 13,
  "seasonRange": null, "seasonList": null,
  "isCompletePack": false,
  "_part": null
}
```

Taxonomy (jellyjake): `collection | season_batch | episode | episode_collection |
movie | others`. This is about what one torrent name represents for download decisions.

### classifyFile(candidate) → ClassificationResult

```json
{
  "type": "series", "title": "Show Name", "episode_title": null,
  "series_alias": null, "year": 2020,
  "season": 1, "episode": 2,
  "confidence": 0.9, "reason": "Matched episode/season pattern",
  "extra_type": null
}
```

`candidate` = `{ source_root_key, source_root, source_path, name, extension,
container_path, relative_path, file_size, in_progress }`. Kinds (jellysort):
`series | movie | extra | skip`, where `extra` carries `extra_type`
(`sample/trailer/behind/deleted/interview/featurette/short/special/extra`). The wire
field is `kind` (mirrors jellysort's `ClassificationResult.kind`, field alias `type`).

### extractSE(name) → SE

```json
{ "season": 1, "episode": 5, "episodeEnd": null, "seasonRange": null, "seasonList": null }
```

Query-oriented S/E extraction (episode/movie search). Ranges preserved.

## Consumers

| Consumer | Language | How it consumes |
|----------|----------|-----------------|
| jellyjake | Node.js | `import { categorize } from 'guessit-next'` (in-process; `queryBuilder.js` keeps only ranking/matrix logic on top) |
| jellysort | Python | spawns `node guessit-next/bin/index.js --serve --json` once per scan; JSON-lines request/response; `app/classification/` becomes (or is replaced by) a thin client. Any response shape change is caught by cli.test.js |

## Phase plan

### Phase 1 — Package (this effort, current)

Build the standalone package with its independent test suite. Both consumers
continue to run their own code unchanged; nothing outside this folder is touched.
Consumers are **read-only** throughout — we only read `jellyjake`/`jellysort` to port
code/tests. **Tests first:** the registries below are written down before any `src/`
implementations, then implementations land to turn them green.

1. Scaffold `package.json`, ESM layout, `src/` + `tests/` + `bin/` (no logic yet).
2. **Write the test registries first** (ported from consumers, obfuscated):
   - `tests/categorize.test.js` — jellyjake `tests/classify.test.js` registry scaled
     to full parity, moved (not copied) so it passes against the shared package.
   - `tests/se.test.js` — jellyjake SE registry + jellysort JellyJake-ported cases.
   - `tests/classifyFile.test.js` — jellysort `test_classifier.py` + corpus regression.
   - `tests/cli.test.js` — JSON field contract (both consumers depend on it).
   These start red against an empty `src/` (asserting expected results).
3. Lift jellyjake categorization core (`normalize`, `patterns`, `se`, `categorize`)
   into `src/` until `categorize.test.js` + `se.test.js` are green.
4. Port jellysort file/folder classification (`classifyFile`, `kinds`, `titles`) from
   Python to JS, mapping `app/classification/*` semantics 1:1, until
   `classifyFile.test.js` is green.
5. Merge/extend the one S/E core so both registries pass with a single implementation
   (this is where the dedup happens — jellysort's `episodes.py` today duplicates a
   subset of jellyjake's `extractSEFromName`; the merge removes the duplication).
6. Add the cli/`--serve` handshake test if not already covered.
7. `npm test` green; commit; tag `v0.1.0`.

Deliverable: independent, tested package with all classification logic and both
regression registries. No consumer changes.

### Phase 2 — Integrate jellyjake (consumer is read-only until user says go)

- Replace `classifyTorrent` / `extractSEFromName` calls in `queryBuilder.js` with
  imports from guessit-next (keep ranking/coverage/matrix logic in jellyjake).
- Delete duplicated regex/helper code from `queryBuilder.js` that moved here.
- Port the registry tests to run against the shared package (verify identical cat
  results; no jellyjake behavior change).
- **All of the above modifies `/www2/jellyjake` — requires explicit user instruction.**

### Phase 3 — Integrate jellysort (consumer is read-only until user says go)

- Add Node runner to jellysort's Docker image (node binary or vendored package).
- Replace `app/classification/` imports with a stdio client over
  `node guessit-next/bin/index.js --serve --json`; delete `app/classification/` Python.
- Point corpus regression at the wrapper; `pytest tests/` green.
- **All of the above modifies `/www1/jellysort` — requires explicit user instruction.**

## Regression strategy

- jellyjake's `tests/classify.test.js` registry (~120 entries) is the **canonical
  categorization registry** — port it (obfuscated) into `tests/categorize.test.js`,
  keeping every entry so parity is proven, then run against the single shared core.
- jellysort's `tests/corpus/download_paths.json` (obfuscated) is the **canonical
  per-file corpus** — it lives at `scratch/corpus.json` (user-maintained,
  never committed) and `tests/classifyFile.test.js` reads it from there,
  skipping if absent.
- Port jellysort's `tests/test_classifier.py` unit tests to JS.
- Add a parity assertion for both layers across their shared registries.

### Obfuscation rule

Same as jellysort: real media names and release groups never appear in code,
fixtures, commits, or logs. Use neutral placeholders. `scratch/corpus.json` must keep
identical formatting tokens (`SxxEyy`, `v2`, `REPACK`, years, resolution/codec
strings, episode-per-folder counts) so behavior is unchanged, but all real names are
randomized. Never commit a reverse mapping. (Corpus location fix: the file
itself lives in gitignored `scratch/` per plan 02 — only obfuscated genes
land in `tests/`.)

## Working rules for the new session

The `AGENTS.md` in this folder is the live rules handbook for the session that
implements the plan (tests-first, read-only consumers, obfuscation, single source of
truth, JSON contract, two vocabularies). Keep `AGENTS.md` and this plan consistent:
if a rule lands in one, mirror it in the other.

## Verification

- `npm test` in `/www1/guessit-next` — full suite green (ported registries + JSON contract).
- Spot-check a few known-tricky names on the CLI: x-notation codec tails, `S01E01-E13`
  ranges, `Season 1 - 720p` resolution traps, bundle containers with extras, foreign
  episode words, year-in-parens, underscore-joined extra markers.

## Addendum — folder-aware single + batch classification (user directive)

The caller hands this package **paths**, never bare guesses. Every input shape below
must work, because "anything can happen" in a downloads folder, a torrent folder,
or an existing library path:

1. **Single file with its parent path** — e.g. a file already sitting in Jellyfin,
   or one loose file in downloads: `{ name, source_path, source_root,
   container_path, relative_path, file_size }`. The parent folders participate in
   parsing (folder-season, folder-title authority).
2. **A torrent folder** — `container_path` names the torrent; `relative_path` carries
   `Season 02/…` subfolders and inner files. Files inside one container relate to
   each other and must end up "on the same page" (same series identity/type unless
   evidence contradicts).
3. **A batch of related files at once** — many candidates sharing one folder are
   classified in a single call so folder context is computed once and agreement is
   enforced across the batch.

### API surface (all of it is public; all of it is tested)

- `categorize(name)` — one torrent/release name → kind + markers (unchanged).
- `extractSE(name)` — S/E structure, ranges preserved (unchanged).
- `classifyFile(candidate, opts?)` — one file → `ClassificationResult`.
  `opts = { seriesAliases?: Record<string,string> }` (alias map, jellysort
  `series_title_aliases`).
- `classifyFiles(candidates, opts?)` — many files → `{ results, groups }`.
  `results` is one `ClassificationResult` per input **in input order**.
  `groups` is one summary per folder (see below). This is the call a scanner uses
  per torrent folder / per directory listing.

### Contract change (additive, locked by `tests/cli.test.js`)

`ClassificationResult` gains one field — `episodeEnd: number | null` (default
`null`). Single-file semantics still collapse ranges to the start `episode`
(jellysort behavior), but a multi-episode file (`S01E01-E13`) now also reports
where its range ends, so a caller can answer "how many episodes does this file
contain" without re-parsing the name. Every other field is unchanged
(`type/title/episode_title/series_alias/year/season/episode/confidence/reason/
extra_type`).

### `classifyFiles` group contract

- Group key = `container_path ?? source_path`: files in one torrent folder form
  one group; loose files without a container are each their own group (so
  unrelated shows under one scan root are never forced to agree).
- Each group: `{ key, title, type, seasons: number[], episodesBySeason:
  Record<string, number[]>, fileCount, episodeFileCount, extraFileCount,
  consistent: boolean, conflicts: string[] }`.
  `seasons` / `episodesBySeason` are sorted unique numbers across the group's
  series-typed files — the answer to "how many seasons and episodes does this
  folder contain". `episodeFileCount` counts files with an episode number;
  `extraFileCount` counts extras.
- **Agreement rule ("same page"):** the group's `title`/`type` are the majority
  across its series/movie results (normalized comparison). If a file disagrees
  (different show in the same folder), the group reports `consistent: false`,
  names both sides in `conflicts`, and disagreeing files get lowered confidence
  with a reason that says so. Extras never break agreement.
- Empty input → `{ results: [], groups: [] }`.

### `skip` is orchestrator-side, not classifier output

Evidence: jellysort's `classify_candidate` never returns `skip` in any test or
code path — `skip` is assigned by the scan orchestrator (low confidence,
in-progress, non-media). So `classifyFile`/`classifyFiles` emit only
`series | movie | extra`. `src/kinds.js` still documents the full
`series | movie | extra | skip` vocabulary (the wire type both consumers share),
with `skip` marked caller-assigned. `tests/classifyFile.test.js` pins
"classifier never emits skip" plus the sample-size rule that motivated it: a
small movie-size file with NO `sample` marker stays `movie` with a
"sample-size suspect" reason suffix (orchestrator flags it); only a real
`sample` marker routes to `extra/sample`.

### CLI / stdio daemon ops

`bin/index.js` speaks three ops so both consumers use one binary:

- `--json '<name>'` → `categorize` one torrent name, print JSON.
- `--json-file '<path>'` → `classifyFile` one library file (parent folders from
  the path participate; `--root` overrides the scan root).
- `--batch` → stdin JSON-lines of `{ op, ... }`, one JSON result per line:
  `{ op: "categorize", name }`, `{ op: "classifyFile", candidate }`,
  `{ op: "classifyFiles", candidates }`.
- `--serve [--json]` → stdio daemon (one process per scan): same ops as
  `--batch`, looped until EOF. This is the Python consumer's interface.

### Test files (all red before `src/` lands — tests first)

- `tests/categorize.test.js` — torrent-name registry (done, ported obfuscated).
- `tests/se.test.js` — `extractSE` registry: every S/E notation from both
  projects, ranges preserved (`episodeEnd`, cross-season `seasonEnd`,
  `seasonRange`, `seasonList`), codec/resolution/year traps. Ported from
  jellysort `test_classification_episodes.py` + jellyjake SE genes.
- `tests/classifyFile.test.js` — per-file genes ported 1:1 from jellysort
  `test_classifier.py` (fully obfuscated; the one real-title regression case is
  dropped — only its obfuscated twin is kept, with a comment saying why) +
  the corpus regression over `scratch/corpus.json` (seeded verbatim — already
  obfuscated upstream; user-maintained, never committed): no `error` kinds, titles
  free of release junk, no brackets in titles, underscore-junk containers
  resolve to one title.
- `tests/classifyBatch.test.js` — `classifyFiles`: torrent-folder agreement,
  loose-file grouping, conflict flagging, season-from-folder carry, group
  season/episode summaries, empty input.
- `tests/cli.test.js` — JSON field-contract lock (exact field sets for all
  three ops incl. additive `episodeEnd`) + `bin/index.js` smoke tests
  (`--json`, `--batch`, `--serve` round-trip).

### Docs

- `README.md` — full API reference for all four functions + CLI ops (updated).
- `docs/` — small static documentation website (no build step): overview,
  API, CLI/daemon, parsing guards. Linked from README.