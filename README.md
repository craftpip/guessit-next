# guessit-next

Centralized media-name classification engine. One implementation of
"extract seasons, episodes, title and type from media file names and folder
names", shared by a Node.js torrent orchestrator and a Python media organizer —
so the parsing logic is written once, tested once, and consumed twice.

It answers questions like:

- *"Show Name S01E01-E13 1080p"* → an **episode collection**: season 1,
  episodes 1–13.
- *"Show Name (2018) Season 1 - 720p"* → a **season batch**: season 1
  (the `- 720p` is a resolution, not a range end).
- `10-Conclusion.mkv` inside `Neutral Show/` → **series**: title
  `Neutral Show`, episode 10, episode title `Conclusion`.
- `[Group] Show - OVA.mkv` → **extra** (`ova` marker).

## Features

- **`categorize(name)`** — classify one torrent/release name into exactly one
  kind: `collection` | `season_batch` | `episode` | `episode_collection` |
  `movie` | `others`, with season/episode markers attached. Built for
  download decisions (what does this one torrent represent?).
- **`classifyFile(candidate, opts?)`** — classify one library file into
  `series` | `movie` | `extra`, deriving title, episode title, series alias,
  year, season and episode (ranges collapse to the start episode, with the
  range end preserved in `episodeEnd`) from the file **and** folder names.
  Built for organizing files into a media library. Self-contained: no
  third-party parsing dependency. The classifier never emits `skip` — that
  stays a scanner-side decision (low confidence, in-progress, non-media).
- **`classifyFiles(candidates, opts?)`** — classify many related files at
  once (one torrent folder, one directory listing). Returns per-file results
  in input order plus one summary **group** per folder: agreed title/type,
  seasons and episodes contained, file counts, and a `consistent` flag with
  `conflicts` when a file disagrees with its folder. The scanner's call.
- **`extractSE(name)`** — query-oriented season/episode extraction with
  ranges preserved (`episodeEnd`, `seasonRange`, `seasonList`). The single
  S/E core both layers above share.
- **CLI + stdio daemon** — `bin/index.js --json | --batch | --serve`:
  spot-check a name from the shell, classify a batch, or run a JSON-lines
  daemon (one process per scan) for non-Node consumers.
- **Battle-tested parsing guards** — season cap 1–60, episode cap 1–500,
  4-digit years/resolutions never become season/episode numbers, codec tails
  (`1 x264`, `AAC5.1`) never become episodes, anime conventions
  (`S2 - 12 END` finale, `Part N - EE` episodes, `Final Season - 08`).
- **Regression corpus** — the locked-in pattern catalogs from both consumer
  projects, with real titles obfuscated. Every known-tricky name stays green.
- **Zero dependencies, pure ESM** — runs on Node.js ≥ 20 with nothing to
  install beyond the package itself.

## Installation

Requires Node.js ≥ 20.

```bash
git clone <repo-url> guessit-next
cd guessit-next
npm install   # no runtime dependencies; installs nothing extra
```

To use it as a library from another Node.js project:

```js
import { categorize, classifyFile, classifyFiles, extractSE } from 'guessit-next';
```

## Usage

### Node.js API

```js
import { categorize, classifyFile, classifyFiles, extractSE } from './src/index.js';

// 1. What does one torrent name represent?
categorize('Show Name S01E01-E13 1080p');
// → { kind: 'episode_collection', season: 1, episode: 1, episodeEnd: 13,
//     seasonEnd: null, seasonRange: null, seasonList: null,
//     isCompletePack: false }

categorize('Show Name S01-S08 COMPLETE 1080p');
// → { kind: 'collection', season: null, episode: null, episodeEnd: null,
//     seasonEnd: null, seasonRange: [1, 8],
//     seasonList: [1, 2, 3, 4, 5, 6, 7, 8], isCompletePack: true }

// 2. Where does one file belong in a library?
classifyFile({
  name: '10-Conclusion.mkv',
  source_path: '/data/torrents/Neutral Show/10-Conclusion.mkv',
  source_root: '/data/torrents',
  container_path: '/data/torrents/Neutral Show',
  relative_path: '10-Conclusion.mkv',
  file_size: 1024,
});
// → { type: 'series', title: 'Neutral Show', episode_title: 'Conclusion',
//     series_alias: null, year: null, season: null, episode: 10,
//     confidence: 0.9, reason: 'Matched episode/season pattern',
//     extra_type: null }

// 3. Just the season/episode structure (ranges preserved).
extractSE('Show Name S01E01-E13 1080p');
// → { season: 1, episode: 1, episodeEnd: 13, seasonEnd: null,
//     seasonRange: null, seasonList: null }

// 4. A whole torrent folder at once — files stay "on the same page".
classifyFiles([
  { name: 'Show Name - S01E01.mkv', source_path: '/data/torrents/Show Pack/Show Name - S01E01.mkv', source_root: '/data/torrents', container_path: '/data/torrents/Show Pack', relative_path: 'Show Name - S01E01.mkv', file_size: 1024 },
  { name: 'Show Name - S01E02.mkv', source_path: '/data/torrents/Show Pack/Show Name - S01E02.mkv', source_root: '/data/torrents', container_path: '/data/torrents/Show Pack', relative_path: 'Show Name - S01E02.mkv', file_size: 1024 },
]);
// → { results: [ …one ClassificationResult per input, in order… ],
//     groups: [{ key: '/data/torrents/Show Pack', title: 'Show Name',
//       type: 'series', seasons: [1], episodesBySeason: { 1: [1, 2] },
//       fileCount: 2, episodeFileCount: 2, extraFileCount: 0,
//       consistent: true, conflicts: [] }] }
```

### CLI

```bash
# Single torrent name → JSON result
node bin/index.js --json "Show Name S01E01.mkv"

# Single library file (parent folders participate in parsing)
node bin/index.js --json-file "/data/torrents/Neutral Show/10-Conclusion.mkv" --root /data/torrents

# Batch: stdin JSON-lines of { op, ... }, one JSON result per line on stdout
echo '{"op":"categorize","name":"Show Name S01-S03 1080p"}' | node bin/index.js --batch

# Serve: stdio JSON-lines daemon (one process per scan; for non-Node consumers)
node bin/index.js --serve --json
```

Batch/serve ops: `{ op: "categorize", name }`,
`{ op: "classifyFile", candidate }`,
`{ op: "classifyFiles", candidates }`.
```

## API reference

### `categorize(name) → CategoryResult`

`name`: a torrent/release/file name string.

| Field           | Meaning                                                        |
| --------------- | -------------------------------------------------------------- |
| `kind`          | `collection` \| `season_batch` \| `episode` \| `episode_collection` \| `movie` \| `others` |
| `season`        | the single season the item belongs to (or `null`)              |
| `episode`       | the (start) episode number (or `null`)                         |
| `episodeEnd`    | last episode of a range/collection (or `null`)                 |
| `seasonEnd`     | season of `episodeEnd`, when a range crosses seasons (or `null`) |
| `seasonRange`   | `[min, max]` seasons spanned by a multi-season item (or `null`) |
| `seasonList`    | explicit sorted list of every season contained (or `null`)     |
| `isCompletePack`| `true` for "Complete Series" / "All Seasons" / "… COMPLETE"    |

Kind priority (a name is **never** two kinds at once): `collection` >
`season_batch` > `episode_collection` > `episode` > `movie` > `others`.

### `classifyFile(candidate) → ClassificationResult`

`candidate`:

| Field            | Meaning                                              |
| ---------------- | ---------------------------------------------------- |
| `name`           | file name, e.g. `Show - S01E02.mkv`                  |
| `source_path`    | full path of the file                                |
| `source_root`    | scan root the file was found under                   |
| `container_path` | containing folder (torrent root), if any            |
| `relative_path`  | path of the file relative to the container, if any   |
| `file_size`      | size in bytes, if known                              |

Result:

| Field           | Meaning                                                              |
| --------------- | -------------------------------------------------------------------- |
| `type`          | `series` \| `movie` \| `extra` (`skip` is scanner-side, never emitted here) |
| `title`         | show/movie title                                                     |
| `episode_title` | episode title, when derivable (or `null`)                            |
| `series_alias`  | alternative title, e.g. romanized/foreign alias (or `null`)          |
| `year`          | release year (or `null`)                                             |
| `season`        | season number (or `null`)                                            |
| `episode`       | episode number; ranges collapse to the start episode (or `null`)     |
| `episodeEnd`    | range end for multi-episode files (or `null`)                        |
| `confidence`    | 0–1 confidence in the classification                                 |
| `reason`        | short human-readable reason                                          |
| `extra_type`    | for `extra`: `sample` \| `trailer` \| `behind` \| `deleted` \| `interview` \| `featurette` \| `short` \| `special` \| `extra` |

### `classifyFiles(candidates, opts?) → { results, groups }`

`results`: one `ClassificationResult` per input, in input order.
`groups`: one summary per folder (group key = `container_path`, or
`source_path` for loose files, which are each their own group):

| Field              | Meaning                                                           |
| ------------------ | ----------------------------------------------------------------- |
| `key`              | folder path (or lone file path)                                   |
| `title` / `type`   | majority identity across the group's series/movie results         |
| `seasons`          | sorted unique seasons contained                                   |
| `episodesBySeason` | `{ "<season>": [sorted unique episodes] }`                        |
| `fileCount`        | files in the group                                                |
| `episodeFileCount` | files with an episode number                                      |
| `extraFileCount`   | files classified as extras                                        |
| `consistent`       | `false` when a file disagrees with the folder majority            |
| `conflicts`        | human-readable descriptions of each disagreement                  |

A disagreeing file gets lowered confidence with a conflict reason; extras
never break agreement. Empty input returns `{ results: [], groups: [] }`.

### `extractSE(name) → SE`

```json
{ "season": 1, "episode": 5, "episodeEnd": null, "seasonRange": null, "seasonList": null }
```

Same parsing core as `categorize`, without the kind decision. Ranges are
preserved (`episodeEnd`, cross-season `seasonEnd`, `seasonRange`,
`seasonList`); single-file consumers (`classifyFile`) collapse ranges to the
start episode.

## Parsing behavior worth knowing

These guards are locked in by the test registries — they are features, not
accidents:

- Seasons are 1–60, episodes 1–500. Four-digit values are years or
  resolutions and never become season/episode numbers (`S02 - 2019` is a
  season batch, never a `[2, 2019]` collection; `Season 1 - 720p` is a season
  batch, never `[1, 720]`).
- x-notation `1x05` requires season ≤ 60 (kills `1920x1080`) and episode ≠
  264/265 (kills `1 x264` codec tails).
- Anime finale `S2 - 12 END` is S02E12 (an episode), never a season range.
- `S01 1-2` means S01E01–S01E02 (episode collection), not a season batch.
- `Part N - <num>` with a season anchor is an episode designator; a bare
  `Part N` (no dash-number) is a part pack.
- A bare `complete` with no season/movie signals is a complete pack — but
  `Season 3 Complete` stays a season batch, and a year + release-quality
  movie with "complete" in its title stays a movie.
- Codec decimals (`Opus 2.0`, `DDP2.0`) are never treated as decimal
  episodes; `2.5 Title…` never yields a bare-episode `5`.
- For library files, the folder is authoritative for series identity: a
  `10-Conclusion.mkv` inside `Neutral Show/` takes the folder's title, while
  a `3 Owls (2009).mkv` inside its own `3 Owls (2009)/` folder keeps its
  leading number as part of the movie title.

## Testing

```bash
npm test            # node --test tests/ — full suite, zero test dependencies
```

- `tests/categorize.test.js` — the canonical categorization registry
  (~120 torrent-name patterns; each entry pins the exact expected output,
  and unspecified markers must stay at their defaults).
- `tests/se.test.js` — the S/E extraction registry (ranges preserved,
  codec/resolution traps).
- `tests/classifyFile.test.js` — per-file classification units plus the
  shared corpus regression (`scratch/corpus.json` — user-maintained, never committed):
  titles must stay free of release junk (`1080p`, `x265`, group tags,
  brackets).
- `tests/classifyBatch.test.js` — folder-aware batch classification:
  torrent-folder agreement, loose-file grouping, conflict flagging,
  season-from-folder carry, group season/episode summaries.
- `tests/cli.test.js` — locks the JSON field contract the consumers depend
  on. Any change to these bytes is a breaking change.

To spot-check one name while developing:

```bash
node bin/index.js --json "Show Name S01E01.mkv"
```

## Project structure

```
package.json          name: guessit-next, type: module, exports map, scripts
src/
  normalize.js        name cleaning (separator normalization, lowercase)
  patterns.js         the merged regex set + sane caps/guards (single source of truth)
  se.js               extractSE family — S/E extraction, folder-season, bare-episode, codec guards
  categorize.js       categorize(name) — the torrent-name → kind cascade
  classifyFile.js     classifyFile(candidate) — file → series/movie/extra/skip + titles
  kinds.js            kind vocabularies + extra_type mapping (shared vocab)
  titles.js           title extraction from file + folder names
  index.js            public API: categorize, classifyFile, extractSE
bin/index.js          CLI: --json <name> | --batch | --serve (stdio JSON-lines)
scratch/corpus.json   user-maintained regression corpus (never committed)
tests/                categorize, se, classifyFile, cli (JSON contract)
plans/                this project's plans
```

## Design decisions

- **Node.js is the source of truth.** Classification is pure regex + logic
  with no heavy native dependencies, so one JavaScript implementation serves
  both consumers: the Node.js consumer imports it in-process (native speed,
  zero subprocess overhead); the Python consumer talks to the stdio daemon
  (`node bin/index.js --serve --json`, one process per scan, JSON-lines
  in/out).
- **Two vocabularies, one core.** Torrent categorization
  (`collection | season_batch | episode | episode_collection | movie | others`)
  and file classification (`series | movie | extra | skip`) are different
  views of the same parse core. They are not collapsed into each other, and
  the S/E core carries neither project's domain vocabulary.
- **One regex, one place.** If a pattern or S/E rule exists in more than one
  place, that is a bug — it belongs in `src/patterns.js` or `src/se.js`.
  This project exists to end the duplication.
- **JSON fields are the public interface.** Field names are the contract
  both consumers program against; `tests/cli.test.js` locks them.

## Roadmap

- **Phase 1** (current) — standalone package with its independent test
  suite. Consumers keep running their own code unchanged.
- **Phase 2** — the Node.js consumer replaces its local
  `classifyTorrent` / `extractSEFromName` calls with imports from this
  package (ranking/matrix/coverage logic stays there).
- **Phase 3** — the Python consumer replaces its classification package
  with a stdio client over `bin/index.js --serve --json`.

## Documentation

Full guides live in [`docs/`](docs/) — a small static site (no build step,
open `docs/index.html` in a browser, or read it live at
https://craftpip.github.io/guessit-next/): overview, API reference, properties
catalog, CLI/daemon protocol, parsing guards, and known limitations.

## Contributing

Tests come first. Before any implementation lands, the test registries are
written down; implementation follows only to make the tests pass (red →
green). No `src/` code lands without a failing-then-passing test behind it.

Real series/movie titles and release groups must never appear in code,
fixtures, commits, or logs — use neutral placeholders (`Show Name`,
`[RlsGrp]`, `Movie (2020)`). The corpus must keep identical formatting
tokens (`SxxEyy`, `v2`, `REPACK`, years, resolution/codec strings,
episode-per-folder counts) so behavior is unchanged, but all real names are
randomized. Never commit a reverse mapping.

## License

ISC — see [LICENSE](LICENSE).
