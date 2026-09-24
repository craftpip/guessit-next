# 02 — Corpus expansion from torrent listing archive

## Corpus location fix (user directive — overrides any line below that still says `fixtures/`)

The corpus (test-case file/folder names) lives in the scratch folder:
`scratch/corpus.json`. The user personally maintains and extends it; nothing
under `scratch/` is ever committed (`.gitignore` covers `scratch/*` except
`.keep` markers). Test files simply REFER to the scratch path and skip if it
is absent (fresh checkout). There is no committed `fixtures/` copy. Obfuscated
genes that prove a new shape still land in `tests/*.test.js` as usual.

## Goal

Extend the test registries with real-world shapes harvested from the user's
torrent listing archive, in two streams:

1. **Torrent names** → `tests/categorize.test.js` (+ `tests/se.test.js` where
   S/E structure is involved). For each torrent name, decide whether the
   current spec output is correct; lock in correct ones, fix spec/src for the
   rest (tests-first).
2. **File names inside the torrents** → `scratch/corpus.json` (+ genes in
   `tests/classifyFile.test.js` / `tests/classifyBatch.test.js` as new shapes
   appear). Scrape literally all torrents in the archive and gather every
   distinct inner-file naming format we can find.

Deliverable is **tests + the user's scratch corpus only** (plus throwaway harvest tooling).
No `src/` behavior change lands in this plan unless a harvested name proves
the spec wrong — then it follows the normal red → green loop.

## Non-negotiables (from AGENTS.md — this plan does not override them)

- **Tests first.** New entries land in the registries before any `src/` fix.
- **Obfuscation.** Real series/movie titles and release groups NEVER appear in
  code, fixtures, commits, or logs. Harvested names are obfuscated (neutral
  placeholders: `Show Name`, `[RlsGrp]`, `Movie (2020)`) BEFORE they land.
  Formatting tokens stay identical (`SxxEyy`, `v2`, `REPACK`, years,
  resolution/codec strings, episode-per-folder counts). Never commit a reverse
   mapping. Raw (unobfuscated) scrape output never enters git — it lives in
   gitignored scratch only, as does the working corpus itself
   (`scratch/corpus.json`, user-maintained, never committed).
- **Workspace boundary.** The archive (wherever it lives) is READ-ONLY source
material. All writes (tooling, scratch config, scratch corpus, tests) stay
inside `/www1/guessit-next`. No changes outside this folder.
- **Two vocabularies, one core.** Torrent names → `categorize` kinds
  (`collection | season_batch | episode | episode_collection | movie | others`);
  inner files → `classifyFile` types (`series | movie | extra`). Do not mix them.
- **JSON contract unchanged.** This plan adds rows, not fields.

## Input (open — user to confirm)

- **Archive location/format unknown at plan time.** Expected: a listing of many
  torrents, each with a torrent name + its inner file list (names, ideally
  relative paths + sizes). Could be a dump file, a directory of `.torrent`
  files, an API, or a site scrape.
- **Step 0 must characterize it first:** path/URL, format, access method,
  approximate torrent count, whether inner file lists include paths + sizes,
  auth/rate limits if it is scraped live.
- Until Step 0 is answered, no harvesting starts.

## Plan

### Step 0 — Locate + characterize the archive (read-only)

1. User provides the archive path/URL + format (or grants a path to inspect).
2. Inspect WITHOUT copying real names into the repo: count torrents, identify
   fields per torrent (`torrent_name`, `files[]` with `path/size`), note
   encoding quirks, pagination/rate limits if live.
3. Record in this plan (as an addendum): format, count, field map, scrape
   method. If the archive cannot yield inner file lists, downgrade Stream B
   to torrent-names-only and note it.

### Step 1 — Stream A: torrent-name harvest → categorize/se registries

1. Extract the distinct torrent names (dedupe exact + whitespace/case dupes).
2. Run each through the current `categorize` / `extractSE` (once `src/` exists;
   until then, queue the names and evaluate against the spec text).
3. Triage every name into one bucket:
   - **A — spec correct:** output matches the kind/markers the name should
     produce → candidate for direct registry add.
   - **B — spec wrong:** output contradicts the documented cascade/guards
     (e.g. a resolution glued as range end, a codec tail as episode) →
     file as spec/src bug, fix red → green.
   - **C — spec silent:** a shape the cascade never considered (new tokens,
     new separators, new language words) → decide the correct kind per the
     two-vocabulary rule, add as new gene with a comment.
4. Obfuscate all candidates (Step 3) then append to
   `tests/categorize.test.js` (torrent-level kind) and, where S/E structure
   is the point, mirror in `tests/se.test.js`.
5. Keep the registry's floor assertions healthy (currently ≥60 categorize /
   ≥40 se) — counts must only grow.

### Step 2 — Stream B: scrape ALL torrents → inner-file formats

1. Walk literally every torrent in the archive (no sampling); for each,
   capture: torrent name, each inner file's `relative_path` (or full inner
   path), file name, extension, size if available.
2. Normalize into `classifyFile` candidate shapes (`name`, `container_path`
   = torrent root, `relative_path`, `file_size`) in scratch only.
3. Cluster by **format, not title**: group inner names that share the same
   structural tokens (S/E notation, bare numbers, extras markers, OST/
   Featurette folders, season subfolders, junk-heavy containers) and keep one
   representative per cluster + every outlier that breaks the current
   classifier.
4. Target outputs:
    - Bulk regression growth of `scratch/corpus.json` (same schema as today:
      `candidates[]` with `name/container_path/relative_path/file_size`;
      user-maintained, never committed).
   - New per-file genes in `tests/classifyFile.test.js` for each genuinely
     new shape (folder-season carry, bundle/OST layouts, underscore junk,
     decimal episodes, foreign episode words, …).
   - New folder-agreement cases in `tests/classifyBatch.test.js` where one
     torrent's inner files must land "on the same page" (same title/type,
     season/episode summaries, extras excluded from agreement).

### Step 3 — Obfuscation pipeline + private raw suite (mandatory gate before landing)

1. Raw scrape output lives ONLY in gitignored scratch (e.g.
   `scratch/raw/` + `scratch/` in `.gitignore`); it is never committed,
   never pasted into tests/scratch/logs. This raw dump is the user's
   personal property: kept locally, backed up elsewhere by the user, never
   pushed. It is the strong private basis of the project — every raw name
   gets analyzed and tested individually for spec-correctness (Step 1
   triage A/B/C), so the private suite is the full-fidelity oracle.
2. Private runner: a gitignored-checked-in-but-data-free script (e.g.
   `tools/run-private-corpus.mjs`) reads the raw dump from scratch and runs
   `categorize` / `extractSE` / `classifyFile` over every entry locally.
   The script is committed; the data it reads is never committed.
3. Obfuscation pass replaces every real title/group with placeholders while
   preserving byte-shape tokens: `SxxEyy` positions, `v2/REPACK/PROPER`,
   years, resolutions, codecs, episode-per-folder counts, separator style
   (dots/spaces/underscores), bracket placement. The obfuscated copy lands in
   `tests/` genes + `scratch/corpus.json` (never committed).
4. Review the diff for leaks (grep for any original title fragment) before
   `npm test`. Any leak → reject the batch.

### Step 4 — Tooling (inside this project only)

- Harvest scripts live under `tools/` (new, e.g. `tools/harvest-torent-names.mjs`,
  `tools/scrape-torrent-files.mjs`, `tools/obfuscate.mjs`) — plain Node, zero
  new dependencies. They read the archive read-only and write scratch only.
- Scripts are throwaway-friendly but checked in so the harvest is repeatable;
   tests (+ the user's scratch corpus) are the durable artifact, scripts are the ladder.

### Step 5 — Verification

- `npm test` green (`node --test tests/`).
- Registry counts grew (categorize ≥ previous, se ≥ previous, corpus
  candidate count reported in the commit message).
- Corpus hygiene checks still hold: titles free of release junk, no brackets
  in titles, one title per underscore-junk container (existing
  `classifyFile.test.js` corpus regression), plus whatever new genes Step 2
  added.
- Spot-check a sample of new names via `node bin/index.js --json "<name>"`
  (once `bin/` exists).

## Acceptance

- [ ] Step 0 addendum filled (archive format/count/field map).
- [ ] Stream A: N new obfuscated torrent names in `categorize.test.js`
      (+ `se.test.js` mirrors); every B-bucket item fixed red → green or
      explicitly deferred with a reason.
- [ ] Stream B: all torrents walked; cluster report (formats found, counts);
      corpus grown; new genes for new shapes; batch cases for folder agreement.
- [ ] No real titles/groups in `git log -p` / tests (`scratch/` never committed).
- [ ] `npm test` green.

## Step 0 addendum — archive characterized (2026-09-24)

- Source: `/www1/torrent-search-api/data/torrent.db` (46M, SQLite, READ-ONLY).
- Tables: `search_history` (15,799 rows, 11,995 distinct infoHash, all with
  names) + `trending_history` (3,456 rows, all distinct + named).
  `request_log` is telemetry, not listings.
- Per-torrent fields: `name, infoHash, magnetUri, sizeHuman/sizeBytes,
  seeders/leechers, category, uploadedBy, dateUploaded, url, torrent,
  trackers, downloads` (+ `mediaType/searchQuery` in search_history).
- mediaType split (search_history): null 6,505 / unknown 5,409 / series 1,750
  / movie 1,042 / anime 955 / video 138. Providers: piratebay, limetorrent,
  nyaasi, tgx, bt4g, rarbg.
- **Stream A: READY.** Distinct torrent names (dedupe by lower(infoHash))
  dump into `scratch/raw/` for individual spec-correctness triage.
- **Stream B: BLOCKED on this source.** No inner file-list column exists in
  either table. Inner file/folder names must come from elsewhere (resolve
  magnets/infoHashes to torrent file lists, or a second source the user
  provides). Awaiting user decision before any fetching.

## Open questions for the user

1. Where is the archive (path/URL) and what format is it (dump file,
   `.torrent` dir, API, site to scrape)?
2. Does each torrent entry already include its inner file list (+ sizes), or
   must we fetch/scrape each torrent individually (rate limits, auth)?
3. Roughly how many torrents — hundreds, thousands, more?
4. Re-scrapeable over time (keep `tools/` re-runnable), or one-shot import?
