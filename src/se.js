// extractSE family — S/E extraction (ranges preserved), folder-season,
// bare-episode + codec guards.
// Merges jellyjake extractSEFromName (queryBuilder.js) with jellysort
// app/classification/episodes.py. Two entry points, different contracts:
//   extractSE(name)  — full structure {season,episode,episodeEnd,seasonEnd,
//                      seasonRange,seasonList} (nulls default), sane caps
//                      applied (seasons 1..60, episodes 1..500).
//   extractPair(label) — single (season,episode) pair, jellysort
//                      _extract_season_episode collapse semantics (ranges
//                      collapse to start; lone season anchors dropped — a
//                      lone "S02" in "S02 - 2019" yields (null,null) here;
//                      the structure contract above is what keeps the anchor).

import { normalizeParseName } from './normalize.js';
import {
  BARE_EPISODE_RE,
  CODEC_EPISODES,
  CONTAINED_BARE_EPISODE_RE,
  END_EPISODE_S_RE,
  END_EPISODE_WORD_RE,
  EPISODE_MAX,
  EP_ONLY_S_RE,
  EP_ONLY_WORD_RE,
  FOREIGN_EPISODE_RE,
  PART_EP_RE,
  SEASON_DASH_EPISODE_RE,
  SEASON_EPISODE_TOKEN_RE,
  SEASON_FOLDER_RE,
  SEASON_MAX,
  SEASON_WORD_DASH_EPISODE_RE,
  SEASON_WORD_EPISODE_RE,
  X_NOTATION_RE,
  YEAR_TOKEN_RE,
} from './patterns.js';

// All matches with indices (d flag) — shared patterns carry no /g flag
// themselves (stateful), so every multi-match builds a fresh global copy.
function all(re, s) {
  return [...s.matchAll(new RegExp(re.source, 'gid'))];
}

function num(v) {
  if (v == null) return null;
  const n = parseInt(v, 10);
  return Number.isNaN(n) ? null : n;
}

// ─── sane caps ────────────────────────────────────────────────────────────

export function saneSeason(value) {
  if (value == null) return null;
  return value >= 1 && value <= SEASON_MAX ? value : null;
}

export function saneEpisode(value) {
  if (value == null) return null;
  return value >= 1 && value <= EPISODE_MAX ? value : null;
}

// Year-first filters: a year must never become a season/episode.
// E00/S00 (specials/pilot) stay valid — only year-like numbers are dropped.
export function sanitizeSeason(value, year) {
  if (value == null) return null;
  if (year != null && value === year) return null;
  if (value === 0) return 0;
  return saneSeason(value);
}

export function sanitizeEpisode(value, year) {
  if (value == null) return null;
  if (year != null && value === year) return null;
  if (value === 0) return 0;
  return saneEpisode(value);
}

export function extractYear(label) {
  const m = (label || '').match(YEAR_TOKEN_RE);
  return m ? parseInt(m[0], 10) : null;
}

// ─── shared anchors ───────────────────────────────────────────────────────

// Standalone season anchor in the same label ("S04 ... e07").
// Only real anchors (word-boundary S0N or "Season N") — never glued tokens.
export function bareSeasonAnchor(label) {
  const s = label || '';
  const w = s.match(/\bseason\s*0*(\d{1,2})\b/i);
  if (w && saneSeason(+w[1]) != null) return +w[1];
  const forms = all(/\bs0*(\d{1,2})\b/i, s);
  for (let i = forms.length - 1; i >= 0; i--) {
    const v = +forms[i][1];
    if (saneSeason(v) != null) return v;
  }
  return null;
}

// Anime fansub finale: "S2 - 12 END" is S02E12, never a season range.
export function matchEndEpisode(label) {
  const s = label || '';
  const m = s.match(/\bs0*(\d{1,2})\s*[-–]\s*0*(\d{1,3})\s*END\b/i)
    || s.match(/\bseason\s*0*(\d{1,2})\s*[-–]\s*0*(\d{1,3})\s*END\b/i);
  if (!m) return null;
  const season = saneSeason(+m[1]);
  const episode = saneEpisode(+m[2]);
  if (season == null || episode == null) return null;
  return { season, episode };
}

// ─── single-pair cascade (jellysort _extract_season_episode) ──────────────

function matchTokenPair(label) {
  let season = null;
  let episode = null;
  for (const m of all(SEASON_EPISODE_TOKEN_RE, label)) {
    season = num(m.groups.season);
    episode = num(m.groups.episode);
  }
  return [saneSeason(season), saneEpisode(episode)];
}

function matchDashForm(pattern, label) {
  // Dash forms (S02-12, Season 02-12) with year/resolution rejection:
  // "S02 - 2019" / "Season 2 - 1080p" must NOT become an episode.
  let season = null;
  let episode = null;
  for (const m of all(pattern, label)) {
    const epText = m.groups.episode;
    const epEnd = m.indices.groups.episode[1];
    const tail = label.slice(epEnd, epEnd + 1);
    if (epText.length >= 3 && /\d/.test(tail)) continue;
    if (epText.length === 4) continue;
    const after = label.slice(m.index + m[0].length, m.index + m[0].length + 8);
    if (/^\s*(?:480|576|720|1080|2160)p?\b/i.test(after)) {
      if (['480', '576', '720', '1080', '2160'].includes(epText)) continue;
    }
    season = num(m.groups.season);
    episode = parseInt(epText, 10);
  }
  return [saneSeason(season), saneEpisode(episode)];
}

function matchWordEpisode(label) {
  let season = null;
  let episode = null;
  for (const m of all(SEASON_WORD_EPISODE_RE, label)) {
    season = num(m.groups.season);
    episode = num(m.groups.episode);
  }
  return [saneSeason(season), saneEpisode(episode)];
}

function matchXNotation(label) {
  for (const m of all(X_NOTATION_RE, label)) {
    const season = num(m.groups.season);
    const episode = num(m.groups.episode);
    if (!(season >= 1 && season <= SEASON_MAX)) continue;
    if (CODEC_EPISODES.has(episode)) continue;
    if (!(episode >= 1 && episode <= EPISODE_MAX)) continue;
    const before = label.slice(Math.max(0, m.index - 5), m.index);
    if (/\d{3,4}\s*$/.test(before)) continue;
    return [season, episode];
  }
  return [null, null];
}

function matchEndPair(label) {
  for (const re of [END_EPISODE_WORD_RE, END_EPISODE_S_RE]) {
    const m = label.match(re);
    if (m) return [saneSeason(num(m.groups.season)), saneEpisode(num(m.groups.episode))];
  }
  return [null, null];
}

function matchEpOnly(label) {
  let episode = null;
  for (const re of [EP_ONLY_WORD_RE, EP_ONLY_S_RE]) {
    const m = label.match(re);
    if (m) {
      episode = saneEpisode(num(m.groups.episode));
      if (episode != null) break;
    }
  }
  if (episode == null) return [null, null];
  return [bareSeasonAnchor(label), episode];
}

function matchPartEpisode(label) {
  const m = PART_EP_RE.exec(label);
  PART_EP_RE.lastIndex = 0;
  if (!m) return [null, null];
  const episode = saneEpisode(num(m.groups.episode));
  if (episode == null) return [null, null];
  const after = label.slice(m.index + m[0].length, m.index + m[0].length + 4);
  if (/^\s*p\b/i.test(after) && [480, 576, 720, 1080, 2160].includes(episode)) return [null, null];
  const anchor = bareSeasonAnchor(label);
  if (anchor == null) return [null, null];
  return [anchor, episode];
}

function matchSBareRange(label) {
  const m = label.match(
    /\bs0*(?<season>\d{1,2})\s+0*(?<episode>\d{1,3})\s*(?:(?:to|till|thru|through)\b|[-–])\s*0*\d{1,3}\b/i,
  );
  if (!m) return [null, null];
  return [saneSeason(num(m.groups.season)), saneEpisode(num(m.groups.episode))];
}

export function extractPair(label) {
  const s = label || '';
  let season;
  let episode;
  [season, episode] = matchEndPair(s);
  if (season != null || episode != null) return { season, episode };
  [season, episode] = matchTokenPair(s);
  if (season != null || episode != null) return { season, episode };
  const rangeStart = s.match(
    /(?:^|[^a-z0-9])s(?<season>\d{1,2})e(?<episode>\d{1,3})\s*(?:(?:to|till|thru|through)\b|[-–])\s*e?0*\d{1,3}(?:[^a-z0-9]|$)/i,
  );
  if (rangeStart) {
    return { season: saneSeason(num(rangeStart.groups.season)), episode: saneEpisode(num(rangeStart.groups.episode)) };
  }
  [season, episode] = matchSBareRange(s);
  if (season != null || episode != null) return { season, episode };
  for (const re of [SEASON_DASH_EPISODE_RE, SEASON_WORD_DASH_EPISODE_RE]) {
    [season, episode] = matchDashForm(re, s);
    if (season != null || episode != null) return { season, episode };
  }
  [season, episode] = matchWordEpisode(s);
  if (season != null || episode != null) return { season, episode };
  [season, episode] = matchXNotation(s);
  if (season != null || episode != null) return { season, episode };
  [season, episode] = matchPartEpisode(s);
  if (season != null || episode != null) return { season, episode };
  [season, episode] = matchEpOnly(s);
  if (episode != null) return { season, episode };
  return { season: null, episode: null };
}

// ─── full structure (jellyjake extractSEFromName, caps applied) ───────────

function hasCompletePack(n) {
  return /\b(complete|all\s*seasons?|season\s*all|full\s*series|entire\s*series)\b/i.test(n);
}

function blankSE() {
  return { season: null, episode: null, episodeEnd: null, seasonEnd: null, seasonRange: null, seasonList: null };
}

export function extractSE(name) {
  return extractSEFromNormalized(normalizeParseName(name));
}

// Only used with normalizeParseName output in tests/CLI; exported for reuse.
export function extractSEFromNormalized(n) {
  const out = blankSE();
  if (!n) return out;

  const endEp = matchEndEpisode(n);
  if (endEp) {
    out.season = endEp.season;
    out.episode = endEp.episode;
    return out;
  }
  // S-form + bare episode range: "S01 1 to 2" prefixes BOTH episodes.
  const seSpace = n.match(/\bs0*(\d+)\s+0*(\d+)\s*(?:(?:to|till|thru|through)\b|[-–])\s*0*(\d+)\b/);
  if (seSpace) {
    const startSeason = saneSeason(+seSpace[1]);
    if (startSeason == null) return out;
    out.season = startSeason;
    out.episode = saneEpisode(+seSpace[2]);
    out.episodeEnd = saneEpisode(+seSpace[3]);
    return out;
  }
  // Season lists: "Season 1, 2, 3" / "S1-S2-S3".
  const seasonList = parseSeasonList(n);
  if (seasonList) {
    out.seasonRange = [seasonList[0], seasonList[seasonList.length - 1]];
    out.seasonList = seasonList;
    return out;
  }
  // Multi-season ranges: "S01-S08" / "Season 1 to 4".
  const seasonRangeS = n.match(/s0*(\d+)\s*[-–]\s*s?0*(\d+)(?!\w)/);
  if (seasonRangeS && String(seasonRangeS[2]).length < 4) {
    const lo = saneSeason(+seasonRangeS[1]);
    const hi = saneSeason(+seasonRangeS[2]);
    if (lo != null && hi != null && lo !== hi) {
      out.seasonRange = [lo, hi];
      return out;
    }
  }
  const seasonRangeWord = n.match(/seasons?\s*0*(\d+)\s*(?:(?:to|till|thru|through)\b|[-–])\s*(?:seasons?\s*)?0*(\d+)(?!\w)/);
  if (seasonRangeWord && String(seasonRangeWord[2]).length < 4) {
    const lo = saneSeason(+seasonRangeWord[1]);
    const hi = saneSeason(+seasonRangeWord[2]);
    if (lo != null && hi != null && lo !== hi) {
      out.seasonRange = [lo, hi];
      return out;
    }
  }
  // Cross-season S-form range first: "S01E09-S02E01". An invalid start
  // season voids the whole token (no salvaged episodes).
  const seRangeFull = n.match(/s0*(\d+)\s*e0*(\d+)\s*(?:(?:to|till|thru|through)\b|[-–])\s*s0*(\d+)\s*e0*(\d+)/);
  if (seRangeFull) {
    const startSeason = saneSeason(+seRangeFull[1]);
    if (startSeason == null) return out;
    out.season = startSeason;
    out.episode = saneEpisode(+seRangeFull[2]);
    out.seasonEnd = saneSeason(+seRangeFull[3]);
    out.episodeEnd = saneEpisode(+seRangeFull[4]);
    return out;
  }
  const seRange = n.match(/s0*(\d+)\s*e0*(\d+)\s*(?:(?:to|till|thru|through)\b|[-–])\s*e?0*(\d+)/);
  if (seRange) {
    const startSeason = saneSeason(+seRange[1]);
    if (startSeason == null) return out;
    out.season = startSeason;
    out.episode = saneEpisode(+seRange[2]);
    out.episodeEnd = saneEpisode(+seRange[3]);
    return out;
  }
  // Dash forms with year/resolution rejection: "S2 - 02" is S02E02,
  // "S02 - 2019" is nothing (falls through to the lone S02 anchor below).
  for (const re of [SEASON_DASH_EPISODE_RE, SEASON_WORD_DASH_EPISODE_RE]) {
    const [dSe, dEp] = matchDashForm(re, n);
    if (dSe != null || dEp != null) {
      out.season = dSe;
      out.episode = dEp;
      return out;
    }
  }
  // Episode ranges with no season prefix: "E01-E13" / "Episodes 1-13".
  const epRange = n.match(/\be0*(\d+)\s*(?:(?:to|till|thru|through)\b|[-–])\s*e?0*(\d+)/)
    || n.match(/\b(?:episodes?|eps?)\s*0*(\d+)\s*(?:(?:to|till|thru|through)\b|[-–])\s*(?:(?:episodes?|eps?)\s*)?0*(\d+)/);
  if (epRange) {
    const sTok = n.match(/\bs0*(\d+)\s+(?:episodes?|eps?)\s*0*(\d+)/i);
    out.season = sTok && +sTok[2] === +epRange[1] ? saneSeason(+sTok[1]) : null;
    if (out.season == null) out.season = bareSeasonAnchor(n);
    out.episode = saneEpisode(+epRange[1]);
    out.episodeEnd = saneEpisode(+epRange[2]);
    return out;
  }
  // Word forms, cross-season first.
  const seWordCross = n.match(/season\s*0*(\d+)\s*(?:episodes?|eps?)\s*0*(\d+)\s*(?:(?:to|till|thru|through)\b|[-–])\s*season\s*0*(\d+)\s*(?:episodes?|eps?)\s*0*(\d+)/);
  if (seWordCross) {
    const startSeason = saneSeason(+seWordCross[1]);
    if (startSeason == null) return out;
    out.season = startSeason;
    out.episode = saneEpisode(+seWordCross[2]);
    out.seasonEnd = saneSeason(+seWordCross[3]);
    out.episodeEnd = saneEpisode(+seWordCross[4]);
    return out;
  }
  const seWordRange = n.match(/season\s*0*(\d+)\s*(?:episodes?|eps?)\s*(?:[-–]\s*)?0*(\d+)\s*(?:(?:to|till|thru|through)\b|[-–])\s*(?:e(?:pisode|pisodes?|ps?)\s*)?0*(\d+)/);
  if (seWordRange) {
    const startSeason = saneSeason(+seWordRange[1]);
    if (startSeason == null) return out;
    out.season = startSeason;
    out.episode = saneEpisode(+seWordRange[2]);
    out.episodeEnd = saneEpisode(+seWordRange[3]);
    return out;
  }
  const seWord = n.match(/season\s*0*(\d+)\s*(?:episodes?|eps?)\s*(?:[-–]\s*)?0*(\d+)/);
  if (seWord) {
    const startSeason = saneSeason(+seWord[1]);
    if (startSeason == null) return out;
    out.season = startSeason;
    out.episode = saneEpisode(+seWord[2]);
    return out;
  }
  // Standard SxxExx.
  const se = n.match(/s0*(\d+)\s*e0*(\d+)/);
  if (se) {
    const startSeason = saneSeason(+se[1]);
    if (startSeason == null) return out;
    out.season = startSeason;
    out.episode = saneEpisode(+se[2]);
    return out;
  }
  // x-notation + cross-season x-range.
  const xRange = n.match(/(?<![\d.])(?<!\d )\b(\d{1,2})\s*x\s*(\d{1,3})\s*(?:(?:to|till|thru|through)\b|[-–])\s*(\d{1,2})\s*x\s*(\d{1,3})\b/);
  if (xRange && +xRange[1] >= 1 && +xRange[1] <= SEASON_MAX && +xRange[3] >= 1 && +xRange[3] <= SEASON_MAX) {
    const ep1 = +xRange[2];
    const ep2 = +xRange[4];
    if (!CODEC_EPISODES.has(ep1) && !CODEC_EPISODES.has(ep2)) {
      out.season = +xRange[1];
      out.episode = saneEpisode(ep1);
      out.seasonEnd = +xRange[3];
      out.episodeEnd = saneEpisode(ep2);
      return out;
    }
  }
  const xNot = n.match(/(?<![\d.])(?<!\d )\b(\d{1,2})\s*x\s*(\d{1,3})\b/);
  if (xNot && +xNot[1] >= 1 && +xNot[1] <= SEASON_MAX) {
    const ep = +xNot[2];
    if (!CODEC_EPISODES.has(ep)) {
      out.season = +xNot[1];
      out.episode = saneEpisode(ep);
      return out;
    }
  }
  // Anime part-episode with season anchor: "S04 Part 2 - 06" is S04E06.
  {
    const [pSe, pEp] = matchPartEpisode(n);
    if (pSe != null || pEp != null) {
      out.season = pSe;
      out.episode = pEp;
      return out;
    }
  }
  // Season-only: "Season 1" / standalone "S03".
  const s = n.match(/season\s*0*(\d+)/);
  if (s) {
    out.season = saneSeason(+s[1]);
    return out;
  }
  const sOnly = n.match(/\bs0*(\d+)\b/);
  if (sOnly && !/e\d+/.test(n)) {
    out.season = saneSeason(+sOnly[1]);
    return out;
  }
  // Complete pack (last, only with no season/episode structure).
  if (hasCompletePack(n)) {
    return out;
  }
  // Episode-only: "E05" / "Episode 5" / "Ep 12" — carries the same-label
  // season anchor ("S04 Part2 e07" → S04E07).
  const e = n.match(/\be0*(\d+)\b/) || n.match(/\bepisode\s*[-–]?\s*0*(\d+)\b/i) || n.match(/\beps?\s*[-–]?\s*0*(\d+)\b/i);
  if (e) {
    out.season = bareSeasonAnchor(n);
    out.episode = saneEpisode(+e[1]);
    return out;
  }
  // Foreign episode words: "Episodio 04" (no season to carry).
  const fm = n.match(FOREIGN_EPISODE_RE);
  if (fm) {
    out.episode = saneEpisode(parseInt(fm[1], 10));
    return out;
  }
  // Part-split packs ("S04 Part 1", "Season 4 Part 2") carry no episode
  // structure — a bare Part N is a part pack, never a season batch here.
  {
    const seasonWm = n.match(/season\s*0*(\d+)/);
    let seasonSm = null;
    if (!/\be0*(\d+)\b/.test(n) && !/season\s*0*(\d+)/.test(n)) {
      seasonSm = n.match(/\bs0*(\d+)\b/);
    }
    const seasonNum = seasonWm ? +seasonWm[1] : (seasonSm ? +seasonSm[1] : null);
    const partWm = n.match(/\bpart\s*(?:0*(\d{1,2}))\b/i);
    const partSm = n.match(/\bs0*(\d+)\s+p\s*0*(\d{1,2})(?!\w)/i);
    const partNum = partWm ? +partWm[1] : (partSm ? +partSm[2] : null);
    if (seasonNum != null && partNum != null && partNum >= 1 && partNum <= 30) return out;
  }
  // Bare episode, last resort: one standalone number 1..500. It must not
  // touch a neighbor that carries digits — that kills decimal fragments
  // ("Opus 2.0" → "2 0") and codec tails ("1 x264", "aac5 1"). 4-digit
  // years never match \d{1,3} + \b; dimensions are single tokens.
  {
    const tokens = n.split(' ');
    for (let i = 0; i < tokens.length; i++) {
      if (!/^\d{1,3}$/.test(tokens[i])) continue;
      const v = +tokens[i];
      if (v < 1 || v > EPISODE_MAX) continue;
      if (/\d/.test(tokens[i - 1] || '') || /\d/.test(tokens[i + 1] || '')) continue;
      out.episode = v;
      return out;
    }
  }
  return out;
}

// ─── season lists (jellyjake parseSeasonList) ─────────────────────────────

export function parseSeasonList(n) {
  const word = n.match(/seasons?\s*0*(\d+)((?:\s*(?:[,&+\-–]|\band\b|\bto\b)\s*(?:seasons?\s*)?0*(\d+))+)/);
  const sform = word ? null : n.match(/\bs0*(\d+)\b((?:\s*(?:[,&+\-–]|\band\b|\bto\b)\s*s?0*(\d+))+)/);
  const m = word || sform;
  if (!m) return null;
  const nums = [+m[1]];
  let hasRangeSep = false;
  for (const sm of m[2].matchAll(/([,&+\-–]|\band\b|\bto\b)\s*(?:seasons?\s*)?s?0*(\d+)/g)) {
    if (/[-–]|\bto\b/.test(sm[1])) hasRangeSep = true;
    nums.push(+sm[2]);
  }
  if (nums.length < 2) return null;
  if (Math.max(...nums) > SEASON_MAX) return null;
  const sorted = [...new Set(nums)].sort((a, b) => a - b);
  // A "list" of one distinct season ("S2 - 02") is not a list — without
  // this, the degenerate [2] swallows the dash-episode branch below.
  // (Shared with categorize: only untested same-number corners change.)
  if (sorted.length < 2) return null;
  if (hasRangeSep) {
    const lo = sorted[0];
    const hi = sorted[sorted.length - 1];
    return Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);
  }
  return sorted;
}

// ─── folder / bare-episode helpers (jellysort episodes.py tail) ───────────

function stemOf(name) {
  const base = String(name || '').split('/').pop().split('\\').pop();
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(0, dot) : base;
}

export function extractSeasonFromFolder(candidate) {
  const c = candidate || {};
  if (c.relative_path) {
    const parts = c.relative_path.split('/');
    if (parts.length > 1) {
      for (const part of parts.slice(0, -1)) {
        const m = part.match(SEASON_FOLDER_RE);
        if (m) return parseInt(m.groups.season, 10);
      }
    }
  }
  const source = c.source_path || '';
  const parent = source.split('/').slice(0, -1).pop() || '';
  if (parent) {
    const m = parent.match(SEASON_FOLDER_RE);
    if (m) return parseInt(m.groups.season, 10);
  }
  return null;
}

export function extractBareEpisodeFromName(name) {
  const stem = stemOf(name);
  for (const m of all(BARE_EPISODE_RE, stem)) {
    return parseInt(m.groups.episode, 10);
  }
  return null;
}

export function extractContainedBareEpisode(name) {
  const m = stemOf(name).match(CONTAINED_BARE_EPISODE_RE);
  return m ? parseInt(m.groups.episode, 10) : null;
}

export function extractContainedBareEpisodeTitle(stem) {
  const m = String(stem || '').match(CONTAINED_BARE_EPISODE_RE);
  if (!m) return null;
  return m.groups.title.replace(/^[-._ ]+|[-._ ]+$/g, '') || null;
}
