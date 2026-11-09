// ═══════════════════════════════════════════════════════════════════════════
//  GROUND TRUTH REGRESSION — scratch/gt/ground-truth.json
// ═══════════════════════════════════════════════════════════════════════════
//  The suite that answers "is the classification actually right?".
//
//  The other two corpus suites prove the engine is *structurally* sound: no
//  file returns `skip`, every name yields a valid kind, one group per torrent,
//  and three hygiene budgets that may only shrink. None of that says a single
//  answer is CORRECT. This suite does.
//
//  Ground truth is hand-labeled by agents from scratch/gt/LABELING.md, one
//  format-family shard at a time, and merged by scratch/tools/gt-merge.mjs. The
//  labels are the CORRECT answers, derived by reading the name — never copied
//  from the engine's current output, which is the entire point. So a failure
//  here is a real finding: either the engine is wrong, or a label is wrong, and
//  both are worth surfacing loudly.
//
//  Layers, both from the same labels file format:
//    A) file layer    — classifyFile(candidate) must match all nine labelable
//                       fields exactly: type, title, episode_title,
//                       series_alias, year, season, episode, episodeEnd,
//                       extra_type. `confidence`/`reason` are engine internals
//                       and are never asserted.
//    B) torrent layer — categorize(name) must match its label exactly.
//
//  Only `verified` labels are asserted. `ambiguous` and `corrupt` labels are
//  tracked and reported, never asserted: an honest "this name has two defensible
//  answers" must not turn the suite red, and a missing label must not either.
//
//  Both inputs live in the private scratch/ submodule, never in this repo.
//  Absent either, the suite skips. Everything printed here is masked:
//  real titles never reach logs or CI.
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import crypto from 'node:crypto';
import { categorize, classifyFile } from '../src/index.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const GT_PATH = join(HERE, '..', 'scratch', 'gt', 'ground-truth.json');
const CORPUS_PATH = join(HERE, '..', 'scratch', 'corpus-torrents.json');
const GT = existsSync(GT_PATH) ? JSON.parse(readFileSync(GT_PATH, 'utf8')) : null;
const CORPUS = existsSync(CORPUS_PATH) ? JSON.parse(readFileSync(CORPUS_PATH, 'utf8')) : null;

// Coverage floor. Ground truth only ever grows: RAISE these freely as waves
// land, never lower them — a lower number means labels were lost, and a lost
// label is a hole in the net this suite exists to provide.
const FLOOR = { verifiedFile: 0, verifiedTorrent: 0 };

const FILE_FIELDS = [
  'type', 'title', 'episode_title', 'series_alias',
  'year', 'season', 'episode', 'episodeEnd', 'extra_type',
];
const CATEGORIZE_FIELDS = [
  'kind', 'season', 'episode', 'episodeEnd', 'seasonEnd',
  'seasonRange', 'seasonList', 'isCompletePack',
];

const SKIP = GT && CORPUS
  ? false
  : 'scratch/gt/ground-truth.json or scratch/corpus-torrents.json not present (private scratch/ submodule not checked out)';

// The ground truth stores opaque KEYS, never names. Keys are re-derived here
// from the corpus with the same rule the sharder used (sha1 of
// `lower(infoHash) \0 <path>`, 16 hex chars), so the labels file cannot go
// stale relative to the data and carries no real titles of its own.
function entryKey(infoHash, innerPath) {
  return crypto.createHash('sha1')
    .update(`${String(infoHash).toLowerCase()}\0${innerPath}`)
    .digest('hex')
    .slice(0, 16);
}

function buildIndex() {
  const files = new Map();
  const torrents = new Map();
  for (const t of CORPUS.torrents) {
    torrents.set(entryKey(t.infoHash, 'folder:' + t.name), t.name); // same literal as TORRENT_KEY_PREFIX
    for (const f of t.files) {
      const path = String(f.path || '');
      const name = path.split('/').pop() || path;
      const dot = name.lastIndexOf('.');
      files.set(entryKey(t.infoHash, path), {
        source_root_key: 'x',
        source_root: '/data/torrents',
        source_path: `/data/torrents/${t.name}/${path}`,
        name,
        extension: dot > 0 ? name.slice(dot) : null,
        container_path: t.name,
        relative_path: path,
        file_size: (Number(f.size) || 0) || null,
        in_progress: false,
      });
    }
  }
  return { files, torrents };
}

// Real titles must never reach logs or CI. Mask every alnum run >= 4 chars;
// enough to see "a 7-char word where an 11-char word belongs", useless as a
// title.
function mask(v) {
  if (v == null) return String(v);
  if (typeof v === 'object') return JSON.stringify(v).replace(/[A-Za-z0-9]{4,}/g, (m) => `[${m.length}]`);
  return String(v).replace(/[A-Za-z0-9]{4,}/g, (m) => `[${m.length}]`);
}

const INDEX = GT && CORPUS ? buildIndex() : null;
const verifiedFile = GT ? GT.entries.filter((e) => e.layer === 'file' && e.verdict === 'verified') : [];
const verifiedTorrent = GT ? GT.entries.filter((e) => e.layer === 'torrent' && e.verdict === 'verified') : [];

// A label naming a key the corpus no longer holds is a hole in the net: the
// suite would silently assert less than it appears to. Fail instead. Each layer
// has its own key namespace (inner file vs torrent folder), so check each
// against the right index.
function staleKeys(entries) {
  if (!GT || !CORPUS) return [];
  const out = [];
  for (const e of entries) {
    const index = e.layer === 'torrent' ? INDEX.torrents : INDEX.files;
    if (!index.has(e.key)) out.push(`${e.layer}:${e.key}`);
  }
  return out;
}

describe('ground truth — the labels describe the live corpus', { skip: SKIP }, () => {
  it('every ground-truth key still resolves to a corpus entry', () => {
    const stale = staleKeys(GT.entries);
    assert.deepEqual(
      stale.slice(0, 20),
      [],
      `${stale.length} ground-truth key(s) no longer exist in the corpus — regenerate shards/merge before trusting this suite`,
    );
  });

  it('ground truth is non-empty', () => {
    assert.ok(GT.entries.length > 0, 'ground truth has no entries');
  });

  it('verified coverage never shrinks', () => {
    assert.ok(
      verifiedFile.length >= FLOOR.verifiedFile,
      `verified file labels fell to ${verifiedFile.length} (floor ${FLOOR.verifiedFile})`,
    );
    assert.ok(
      verifiedTorrent.length >= FLOOR.verifiedTorrent,
      `verified torrent labels fell to ${verifiedTorrent.length} (floor ${FLOOR.verifiedTorrent})`,
    );
  });
});

describe('ground truth — layer A: every verified file classifies exactly right', { skip: SKIP }, () => {
  it(`classifyFile matches all labelable fields on ${verifiedFile.length} labeled file(s)`, () => {
    const perField = new Map();
    const samples = [];
    let checked = 0;

    for (const entry of verifiedFile) {
      const candidate = INDEX.files.get(entry.key);
      if (!candidate) continue;
      checked += 1;
      const actual = classifyFile(candidate);
      for (const field of FILE_FIELDS) {
        if (!(field in entry.expect)) continue;
        const got = actual[field];
        const want = entry.expect[field];
        if (got === want) continue;
        perField.set(field, (perField.get(field) || 0) + 1);
        if (samples.length < 40) {
          samples.push(`${entry.key.slice(0, 8)} ${field}: engine=${mask(got)} truth=${mask(want)}`);
        }
      }
    }

    assert.ok(checked > 0, 'no verified file labels resolved against the corpus');
    if (samples.length) {
      const breakdown = [...perField].sort((a, b) => b[1] - a[1])
        .map(([f, n]) => `${f}=${n}`).join(' ');
      console.log(`  field mismatch breakdown: ${breakdown}`);
    }
    assert.deepEqual(
      samples,
      [],
      `${samples.length === 0 ? 0 : perField.size} field(s) wrong across ${checked} labeled files `
      + `(${checked === 0 ? 0 : [...perField.values()].reduce((a, b) => a + b, 0)} mismatches):\n`
      + samples.join('\n'),
    );
  });
});

describe('ground truth — layer B: every verified torrent name categorizes exactly right', { skip: SKIP }, () => {
  it(`categorize matches every labelable field on ${verifiedTorrent.length} labeled torrent(s)`, () => {
    const perField = new Map();
    const samples = [];
    let checked = 0;

    for (const entry of verifiedTorrent) {
      const name = INDEX.torrents.get(entry.key);
      if (name == null) continue;
      checked += 1;
      const actual = categorize(name);
      for (const field of CATEGORIZE_FIELDS) {
        if (!(field in entry.expect)) continue;
        const got = actual[field];
        const want = entry.expect[field];
        if (got === want) continue;
        perField.set(field, (perField.get(field) || 0) + 1);
        if (samples.length < 40) {
          samples.push(`${entry.key.slice(0, 8)} ${field}: engine=${mask(got)} truth=${mask(want)}`);
        }
      }
    }

    assert.ok(checked > 0, 'no verified torrent labels resolved against the corpus');
    if (samples.length) {
      const breakdown = [...perField].sort((a, b) => b[1] - a[1])
        .map(([f, n]) => `${f}=${n}`).join(' ');
      console.log(`  field mismatch breakdown: ${breakdown}`);
    }
    assert.deepEqual(
      samples,
      [],
      `${perField.size} field(s) wrong across ${checked} labeled torrents:\n` + samples.join('\n'),
    );
  });
});

describe('ground truth — the parts that are tracked, not asserted', { skip: SKIP }, () => {
  it('ambiguous and corrupt labels stay visible', () => {
    const tally = GT.entries.reduce((n, e) => {
      n[e.verdict] = (n[e.verdict] || 0) + 1;
      return n;
    }, {});
    const coverage = GT.coverage || {};
    console.log(`  verdicts: ${JSON.stringify(tally)}`);
    for (const [layer, c] of Object.entries(coverage)) {
      const pct = c.unitsTotal ? ((c.unitsLabeled / c.unitsTotal) * 100).toFixed(2) : '0.00';
      console.log(`  ${layer}: ${c.unitsLabeled}/${c.unitsTotal} units labeled (${pct}%) `
        + `verified=${c.verified} ambiguous=${c.ambiguous} corrupt=${c.corrupt} `
        + `shards ${c.shardsLabeled}/${c.shardsTotal}`);
    }
    if (GT.skippedCount) console.log(`  skipped label shards: ${GT.skippedCount} (invalid — not merged)`);
    assert.ok(true);
  });
});
