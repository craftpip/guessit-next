import { describe, it } from 'node:test';
import assert from 'node:assert';
import { extractSE } from '../src/index.js';

// ═══════════════════════════════════════════════════════════════════════════
//  S/E EXTRACTION REGISTRY — extractSE(name)
// ═══════════════════════════════════════════════════════════════════════════
//  Query-oriented season/episode extraction. Unlike classifyFile (which
//  collapses a range to its start episode for single-file routing), extractSE
//  PRESERVES ranges: episodeEnd, cross-season seasonEnd, seasonRange and
//  seasonList are all reported.
//
//  Result shape (every field always present):
//    { season, episode, episodeEnd, seasonEnd, seasonRange, seasonList }
//  Unspecified markers are required to stay null — a pattern that accidentally
//  gains or loses structure FAILS loudly.
//
//  Guards locked in here (features, not accidents):
//    - seasons 1..60, episodes 1..500; 4-digit values are years/resolutions.
//    - x-notation needs season ≤ 60 and episode ≠ 264/265 (codec tails).
//    - "S02 - 2019" keeps its S02 season anchor (episode stays null); the
//      (None,None) pair-fallback in single-file routing is a different
//      function with a different contract — see the comment below.
//    - "S2 - 12 END" is an episode; "S01 1-2" is an episode range.
//    - codec decimals (Opus 2.0) and dimensions (1920x1080) yield nothing.
//
//  Names are obfuscated (neutral placeholders); formatting tokens are kept
//  identical. Real titles/groups never appear here.
// ───────────────────────────────────────────────────────────────────────────

const SE_CASES = [
  // ── single episodes ────────────────────────────────────────────────────
  { name: 'Show.S01E05.720p', expect: { season: 1, episode: 5 } },
  { name: 'Show 1x05 720p', expect: { season: 1, episode: 5 } },
  { name: 'Show 5x12.HDTV.x264-PROPER', expect: { season: 5, episode: 12 } },
  { name: 'Show Season 1 Episode 5 1080p', expect: { season: 1, episode: 5 } },
  { name: 'Show Season 1 Ep 3', expect: { season: 1, episode: 3 } },
  { name: 'Show S2 - 02', expect: { season: 2, episode: 2 } },
  { name: 'Show Name Season 02 - 12', expect: { season: 2, episode: 12 } },
  { name: 'Show - S03E02v2', expect: { season: 3, episode: 2 } },
  { name: 'Show - S03E10v3', expect: { season: 3, episode: 10 } },
  { name: 'Show E05 720p', expect: { episode: 5 } },
  { name: 'Show Episode 5', expect: { episode: 5 } },
  { name: 'Show - 01', expect: { episode: 1 } },
  { name: 'Show Episodio 04', expect: { episode: 4 } }, // foreign episode word

  // ── anime conventions ──────────────────────────────────────────────────
  { name: 'Starfall S04 Part2 e07 Jap 720p', expect: { season: 4, episode: 7 } },
  { name: 'Show S04 Part 2 - 06 1080p', expect: { season: 4, episode: 6 } },
  { name: 'Starfall S2 - 12 END (BS4 4K 3840x2160 x265 AAC).mkv', expect: { season: 2, episode: 12 } },
  { name: 'Show Season 2 - 12 END 1080p', expect: { season: 2, episode: 12 } },

  // ── season anchor kept, episode nulled (year/resolution dash) ──────────
  // NOTE: single-file pair extraction reports (None,None) here by contract
  // (it answers "is there a usable episode pair?"), but extractSE answers
  // "what structure does this name carry?" — and S02 / Season 1 ARE season
  // structure. Both behaviors are pinned: the pair contract in
  // classifyFile.test.js, the structure contract here.
  { name: 'Show S02 - 2019 1080p', expect: { season: 2 } },
  { name: 'Show Season 1 - 720p', expect: { season: 1 } },
  { name: 'Show Season 2 - 2019 1080p', expect: { season: 2 } },

  // ── episode ranges (same season, preserved) ────────────────────────────
  { name: 'Show S01E01-E13 1080p', expect: { season: 1, episode: 1, episodeEnd: 13 } },
  { name: 'Show S01E01-S01E05 1080p', expect: { season: 1, episode: 1, episodeEnd: 5, seasonEnd: 1 } },
  { name: 'Show S01 1-2 720p', expect: { season: 1, episode: 1, episodeEnd: 2 } },
  { name: 'Show S02 1 to 9 1080p', expect: { season: 2, episode: 1, episodeEnd: 9 } },
  { name: 'Show S03 1 - 13 1080p', expect: { season: 3, episode: 1, episodeEnd: 13 } },
  { name: 'Show S01 Eps 1 to 9 720p', expect: { season: 1, episode: 1, episodeEnd: 9 } },
  { name: 'Show Season 1 Episode 1 to 22 720p', expect: { season: 1, episode: 1, episodeEnd: 22 } },
  { name: 'Show E01-E13 1080p', expect: { episode: 1, episodeEnd: 13 } },
  { name: 'Show E01 to E13 1080p', expect: { episode: 1, episodeEnd: 13 } },
  { name: 'Show Episodes 1-13 1080p', expect: { episode: 1, episodeEnd: 13 } },
  { name: 'Starfall S04 Part2 e01-05 (720p Jap MultiSub)', expect: { season: 4, episode: 1, episodeEnd: 5 } },

  // ── cross-season ranges ────────────────────────────────────────────────
  { name: 'Show S01E09-S02E01 1080p', expect: { season: 1, episode: 9, episodeEnd: 1, seasonEnd: 2 } },
  { name: 'Show S01E01-S03E13 1080p', expect: { season: 1, episode: 1, episodeEnd: 13, seasonEnd: 3 } },
  { name: 'Show 1x09 to 2x05 720p', expect: { season: 1, episode: 9, episodeEnd: 5, seasonEnd: 2 } },
  { name: 'Show 1x01-2x13 720p', expect: { season: 1, episode: 1, episodeEnd: 13, seasonEnd: 2 } },
  { name: 'Show Season 1 Episode 9 to Season 2 Episode 5', expect: { season: 1, episode: 9, episodeEnd: 5, seasonEnd: 2 } },

  // ── season ranges and lists (no episodes involved) ─────────────────────
  { name: 'Show S01-S03 1080p', expect: { seasonRange: [1, 3], seasonList: [1, 2, 3] } },
  { name: 'Show S1-S2-S3 WEB-DL', expect: { seasonRange: [1, 3], seasonList: [1, 2, 3] } },
  { name: 'Show S01-S08 COMPLETE 1080p', expect: { seasonRange: [1, 8], seasonList: [1, 2, 3, 4, 5, 6, 7, 8] } },
  { name: 'Show s01 - s03 1080p', expect: { seasonRange: [1, 3], seasonList: [1, 2, 3] } },
  { name: 'Show Season 1 - 3 2160p', expect: { seasonRange: [1, 3], seasonList: [1, 2, 3] } },
  { name: 'Show Season 1 to 4', expect: { seasonRange: [1, 4], seasonList: [1, 2, 3, 4] } },
  { name: 'Show Name Season 1, 2, 3 1080p', expect: { seasonRange: [1, 3], seasonList: [1, 2, 3] } },
  { name: 'Show Season 1+2 WEB-DL', expect: { seasonRange: [1, 2], seasonList: [1, 2] } },
  { name: 'Seasons 1 to 3 1080p', expect: { seasonRange: [1, 3], seasonList: [1, 2, 3] } },

  // ── sane caps ──────────────────────────────────────────────────────────
  { name: 'Show S61E05 720p', expect: {} }, // season > 60: no structure at all
  { name: 'Show S01E501 720p', expect: { season: 1 } }, // episode > 500 dropped, season kept
  { name: 'Show S00E05 720p', expect: {} }, // season 0 is not a season

  // ── codec / dimension / junk traps → nothing ───────────────────────────
  { name: 'Show 1x264 1080p', expect: {} },
  { name: 'Show 1 x264 1080p', expect: {} },
  { name: 'Show 1x265 1080p', expect: {} },
  { name: 'Show x264 AAC5.1 1080p', expect: {} },
  { name: 'Show 1920x1080', expect: {} },
  { name: 'Show Opus 2.0 x265', expect: {} },
  { name: 'Random Garbage Name', expect: {} },

  // ── years are never seasons/episodes ───────────────────────────────────
  { name: 'Some Movie 2023 1080p WEB-DL', expect: {} },
  { name: 'Show Name (2018) Season 1 720p WEB-DL', expect: { season: 1 } },
];

const MARKERS = ['season', 'episode', 'episodeEnd', 'seasonEnd', 'seasonRange', 'seasonList'];

function expectedObject(expect) {
  const defaults = { season: null, episode: null, episodeEnd: null, seasonEnd: null, seasonRange: null, seasonList: null };
  return Object.assign(defaults, expect);
}

describe('S/E extraction registry (extractSE)', () => {
  for (const { name, expect } of SE_CASES) {
    it(name.slice(0, 72) + (name.length > 72 ? '…' : ''), () => {
      const actual = extractSE(name);
      const subset = {};
      for (const k of MARKERS) subset[k] = actual[k];
      assert.deepEqual(subset, expectedObject(expect), name);
    });
  }
});

it('registry has at least 40 locked-in patterns', () => {
  assert.ok(SE_CASES.length >= 40, `only ${SE_CASES.length} patterns — every new pattern goes here`);
});
