import { describe, it } from 'node:test';
import assert from 'node:assert';
import { classifyFiles } from '../src/index.js';

// ═══════════════════════════════════════════════════════════════════════════
//  BATCH CLASSIFICATION — classifyFiles(candidates, opts?)
// ═══════════════════════════════════════════════════════════════════════════
//  The scanner's call: many files that relate to each other because they
//  share a folder are classified in ONE call, so folder context is computed
//  once and the files end up "on the same page".
//
//  Returns { results, groups }:
//    results — one ClassificationResult per input, IN INPUT ORDER.
//    groups  — one summary per folder:
//      { key, title, type, seasons, episodesBySeason, fileCount,
//        episodeFileCount, extraFileCount, consistent, conflicts }
//      key              — container_path, or source_path for loose files
//                         (a loose file is always its own group, so unrelated
//                         shows under one scan root never force agreement).
//      title / type     — majority across the group's series/movie results
//                         (normalized comparison).
//      seasons          — sorted unique seasons across series-typed files.
//      episodesBySeason — { "<season>": [sorted unique episodes] } — the
//                         answer to "how many seasons and episodes does this
//                         folder contain".
//      consistent       — false when a file disagrees with the folder's
//                         majority identity; conflicts names both sides and
//                         the disagreeing file gets lowered confidence with a
//                         reason that says so. Extras never break agreement.
// ───────────────────────────────────────────────────────────────────────────

function _candidate(name, { container_path = null, relative_path = null, file_size = null, source_root = '/data/downloads' } = {}) {
  return {
    source_root_key: 'downloads_0',
    source_root,
    source_path: `${container_path ?? source_root}/${relative_path ?? name}`,
    name,
    extension: name.includes('.') ? name.slice(name.lastIndexOf('.')) : null,
    container_path,
    relative_path,
    file_size,
    in_progress: false,
  };
}

describe('classifyFiles — torrent folder agreement', () => {
  const CONTAINER = '/data/torrents/[RlsGrp] Show Name S01 1080p WEB-DL';

  function seasonPack() {
    return [
      _candidate('[RlsGrp] Show Name - S01E01.mkv', { container_path: CONTAINER, relative_path: '[RlsGrp] Show Name - S01E01.mkv' }),
      _candidate('[RlsGrp] Show Name - S01E02.mkv', { container_path: CONTAINER, relative_path: '[RlsGrp] Show Name - S01E02.mkv' }),
      _candidate('[RlsGrp] Show Name - S01E03.mkv', { container_path: CONTAINER, relative_path: '[RlsGrp] Show Name - S01E03.mkv' }),
      _candidate('[RlsGrp] Show Name - OP.mkv', { container_path: CONTAINER, relative_path: '[RlsGrp] Show Name - OP.mkv' }),
    ];
  }

  it('one folder → one group with season/episode summary', () => {
    const { results, groups } = classifyFiles(seasonPack());
    assert.equal(results.length, 4);
    assert.equal(groups.length, 1);
    const g = groups[0];
    assert.equal(g.key, CONTAINER);
    assert.equal(g.title, 'Show Name');
    assert.equal(g.type, 'series');
    assert.deepEqual(g.seasons, [1]);
    assert.deepEqual(g.episodesBySeason, { 1: [1, 2, 3] });
    assert.equal(g.fileCount, 4);
    assert.equal(g.episodeFileCount, 3);
    assert.equal(g.extraFileCount, 1);
    assert.equal(g.consistent, true);
    assert.deepEqual(g.conflicts, []);
  });

  it('results stay in input order', () => {
    const { results } = classifyFiles(seasonPack());
    assert.deepEqual(
      results.map((r) => [r.episode, r.extra_type]),
      [[1, null], [2, null], [3, null], [null, 'special']],
    );
  });

  it('extras never break agreement', () => {
    const { groups } = classifyFiles(seasonPack());
    assert.equal(groups[0].consistent, true);
  });
});

describe('classifyFiles — loose files', () => {
  it('files without a container are each their own group', () => {
    const { results, groups } = classifyFiles([
      _candidate('Some Movie (2020).mkv'),
      _candidate('Other Movie (2021).mkv'),
    ]);
    assert.equal(results.length, 2);
    assert.equal(groups.length, 2);
    assert.deepEqual(results.map((r) => r.type), ['movie', 'movie']);
    for (const g of groups) {
      assert.equal(g.fileCount, 1);
      assert.equal(g.consistent, true);
    }
  });
});

describe('classifyFiles — conflicts', () => {
  const CONTAINER = '/data/torrents/Mixed Folder';

  it('a foreign show in the same folder is flagged, majority wins', () => {
    const { results, groups } = classifyFiles([
      _candidate('Show Name - S01E01.mkv', { container_path: CONTAINER, relative_path: 'Show Name - S01E01.mkv' }),
      _candidate('Show Name - S01E02.mkv', { container_path: CONTAINER, relative_path: 'Show Name - S01E02.mkv' }),
      _candidate('Show Name - S01E03.mkv', { container_path: CONTAINER, relative_path: 'Show Name - S01E03.mkv' }),
      _candidate('Other Show - S01E01.mkv', { container_path: CONTAINER, relative_path: 'Other Show - S01E01.mkv' }),
    ]);
    assert.equal(groups.length, 1);
    const g = groups[0];
    assert.equal(g.title, 'Show Name');
    assert.equal(g.consistent, false);
    assert.ok(g.conflicts.length > 0, 'conflicts must name both sides');
    assert.ok(g.conflicts.some((c) => c.includes('Other Show')), `conflicts: ${g.conflicts}`);
    const odd = results[3];
    assert.ok(odd.confidence < 0.9, `odd file keeps full confidence: ${odd.confidence}`);
    assert.match(odd.reason, /conflict/i);
    // Majority files keep their classification untouched.
    assert.deepEqual(results.slice(0, 3).map((r) => r.episode), [1, 2, 3]);
    assert.ok(results.slice(0, 3).every((r) => r.confidence === 0.9));
  });
});

describe('classifyFiles — folder context', () => {
  it('season carries from the folder onto bare episode files', () => {
    const container = '/data/torrents/Show Name';
    const { results, groups } = classifyFiles([
      _candidate('01-Pilot.mkv', { container_path: container, relative_path: 'Season 02/01-Pilot.mkv' }),
      _candidate('02-Second.mkv', { container_path: container, relative_path: 'Season 02/02-Second.mkv' }),
    ]);
    assert.deepEqual(results.map((r) => [r.season, r.episode]), [[2, 1], [2, 2]]);
    assert.deepEqual(groups[0].seasons, [2]);
    assert.deepEqual(groups[0].episodesBySeason, { 2: [1, 2] });
  });

  it('movie folder summarizes with no seasons', () => {
    const container = '/data/downloads/Some Movie (2020)';
    const { groups } = classifyFiles([
      _candidate('Some Movie (2020).mkv', { container_path: container, relative_path: 'Some Movie (2020).mkv' }),
      _candidate('Some Movie (2020) - Trailer.mkv', { container_path: container, relative_path: 'Some Movie (2020) - Trailer.mkv' }),
    ]);
    assert.equal(groups[0].type, 'movie');
    assert.deepEqual(groups[0].seasons, []);
    assert.deepEqual(groups[0].episodesBySeason, {});
    assert.equal(groups[0].extraFileCount, 1);
    assert.equal(groups[0].consistent, true);
  });
});

describe('classifyFiles — edge cases', () => {
  it('empty input → empty output', () => {
    assert.deepEqual(classifyFiles([]), { results: [], groups: [] });
  });

  it('seriesAliases opt flows through to every file', () => {
    const { results } = classifyFiles(
      [_candidate('[RlsGrp] Pale Cat - 05.mkv')],
      { seriesAliases: { 'Pale Cat': 'Midnight Cat Pale Cat' } },
    );
    assert.equal(results[0].title, 'Midnight Cat Pale Cat');
  });
});
