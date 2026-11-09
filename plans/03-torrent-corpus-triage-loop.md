# 03 — Continuous triage sweep of the torrent corpus

## Context

The private harvest is done and the corpus files are ready:

- `scratch/corpus-torrents.json` is the canonical, gitignored, user-maintained
  corpus: **2,447 torrents, 163,785 inner files**, sorted deterministically
  (single-file torrents first, then file-count desc, then name), so the array
  ordinal is a stable line number.
- `tests/corpusTorrents.test.js` already wires the corpus into the suite in
  the three consumption modes described below, guarded by budget ceilings
  that may only shrink (junk 3,722 / brackets 2,660 / inconsistent 456).
- Data-quality fact measured at plan time: 185 torrents contain at least one
  dead file row (`path` = `undefined`/empty — a Stream B miss, NOT a
  classifier failure); 3 of them have no usable file at all.

This plan is the main loop: walk the corpus continuously, one torrent at a
time, until every entry is triaged, and keep the cursor in `scratch/AGENTS.md`.

## Canonical data — ONE organization, THREE uses

There is exactly one data shape — the torrent with its inner files:

```json
{ "scan_source": "...", "torrents": [
  { "infoHash": "<hex>", "name": "<folder name>", "source": "...", "fetched_at": "...",
    "files": [ { "path": "<inner relative path>", "size": 123 } ] } ] }
```

The torrent `name` is the download FOLDER (`container_path`); each inner
`path` is a `classifyFile` candidate with `container_path = name`,
`relative_path = path`. No copies, no per-mode files — every consumer reads
these same bytes:

- **Use A — file names first:** every inner file → `classifyFile`.
- **Use B — folder name only:** the torrent name as a folder → `categorize`.
- **Use C — the whole folder + all its files:** one batch → `classifyFiles`
  (expect exactly ONE group keyed by the torrent name, and consistency).

(`corpusTorrents.test.js` layers A/B/C and the triage runner in
`scratch/tools/triage-corpus.mjs` both consume this one file.)

## The sweep cursor (the "line number")

- Cursor = the 0-based ordinal into `torrents[]` (shown 1-based in the
  tracker). That ordinal IS the line: torrent #N of 2,447.
- Raw-dump provenance: the runner builds a hash → (line, file) map from
  `raw/torrents-with-hash.tsv` (15,341 lines) and `raw/torrents-no-hash.tsv`
  (2,385 lines) and records each torrent's source line
  (e.g. `with-hash:1942`). Missing provenance = harvest hash not present in
  the search/trend dumps.
- Human tracker lives in `scratch/AGENTS.md` under `## Triage tracker`.
  Machine cursor mirrors it in `scratch/triage-cursor.json` (same integer).
  Both are updated after every run.

## The loop — one torrent = one step

For torrent at cursor `i` (B, then A, then C):

1. **B** — `categorize(name)` → must land in the six kinds.
2. **A** — every usable inner file → `classifyFile` → type must be
   `series|movie|extra`; `title`/`episode_title` must be free of release junk
   and brackets.
3. **C** — `classifyFiles(files)` → exactly 1 group, `groups[0].key === name`,
   inconsistent only under the measured ceiling.

Verdict, one per torrent, appended to `scratch/triage-log.jsonl`:

- **`ok`** — all contract checks pass (plan-02 bucket A: spec correct).
- **`anomaly`** — a contract violation: wrong kind/type, junk/bracket leak,
  multi-group, wrong key, or an inconsistent multi-file torrent
  (bucket B: spec wrong → fix red→green; bucket C: spec silent → decide the
  shape, obfuscate, add a gene).
- **`hygiene`** — dead file rows (`undefined`/empty path) or an empty name;
  a Stream B miss, explicitly NOT a classifier failure. Logged so it can be
  re-fetched later.

stdout shows masked summaries only; real names appear only in the log.

## Cadence — continuously until it completes

```bash
cd /www1/guessit-next/scratch/tools
node triage-corpus.mjs --chunk 3
```

- Resume-aware: starts at the cursor, burns `chunk` torrents, writes the new
  cursor, exits. Re-invoking continues the sweep.
- `--chunk N` raises the burn rate once anomalies get sparse; `--from N`
  re-bases the cursor (with an override warning).
- **Completion:** cursor reaches 2,447 — every torrent triaged + one log row
  each. Then a follow-on pass resolves the `anomaly` backlog (fix or defer)
  and shrinks the test ceilings.

## Ceiling policy

The test ceilings are upper bounds that must only SHRINK. Each `anomaly` fix
re-measures and lowers the affected ceiling in `tests/corpusTorrents.test.js`.

## Acceptance

- [ ] Cursor in `scratch/AGENTS.md` moves every run and matches
      `triage-cursor.json`.
- [ ] `triage-log.jsonl` has one row per torrent (2,447 when done).
- [ ] Every `anomaly` row is resolved (fix) or explicitly deferred.
- [ ] Ceilings only shrink; `npm test` green; no real names outside `scratch/`.