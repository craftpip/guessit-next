// categorize(name) — jellyjake classifyTorrent cascade (queryBuilder.js).
// One torrent name → exactly one kind:
//   collection | season_batch | episode | episode_collection | movie | others
// Priority: collection > season_batch > episode_collection > episode >
// movie > others. A name is NEVER two kinds at once.
// Shared S/E helpers (bareSeasonAnchor, matchEndEpisode, parseSeasonList)
// come from se.js — single source of truth; only the kind-decision cascade
// and its movie/part signals live here.

import { normalizeParseName } from './normalize.js';
import { bareSeasonAnchor, matchEndEpisode, parseSeasonList } from './se.js';

function hasCompletePhrase(n) {
  return /\b(complete(\s+(series|collection|pack))?|all\s+seasons?|full\s+series|entire\s+series)\b/i.test(n);
}

function hasSeasonAnchor(n) {
  if (/season\s*0*(\d+)/.test(n)) return true;
  if (/s0*(\d+)\s*e0*(\d+)/.test(n)) return true;
  if (/\bs0*(\d+)\b/.test(n)) return true;
  return false;
}

function saneRangeEnd(v) {
  return v != null && String(v).length < 4;
}

function movieSignalsOf(n) {
  const movieWord = /\b(movie|films?)\b/i.test(n);
  const yearTok = /\b(19|20)\d{2}\b/.test(n);
  const releaseTok = /\b(bluray|blu-ray|bdrip|brrip|web-dl|webdl|webrip|hdrip|hdtv|dvdrip|dvdscr|remux|1080p|720p|2160p|4k|x264|x265|hevc|av1)\b/i.test(n);
  const langTok = /\b(english|hindi|japanese|korean|spanish|french|german|tamil|telugu|malayalam|chinese|russian|dual)\b/i.test(n);
  return movieWord || (yearTok && releaseTok) || (releaseTok && langTok);
}

export function categorize(name) {
  const n = normalizeParseName(name);
  const out = { kind: 'others', season: null, episode: null, episodeEnd: null, seasonEnd: null, seasonRange: null, seasonList: null, isCompletePack: false };
  if (!n) return out;

  // ── 1. COLLECTION ──────────────────────────────────────────────────────
  const endEp = matchEndEpisode(n);
  if (endEp) {
    out.kind = 'episode';
    out.season = endEp.season;
    out.episode = endEp.episode;
    return out;
  }
  const seSpace = n.match(/\bs0*(\d+)\s+0*(\d+)\s*(?:(?:to|till|thru|through)\b|[-–])\s*0*(\d+)\b/);
  if (seSpace) {
    out.kind = 'episode_collection';
    out.season = +seSpace[1];
    out.episode = +seSpace[2];
    out.episodeEnd = +seSpace[3];
    out.isCompletePack = false;
    return out;
  }
  const seasonList = parseSeasonList(n);
  if (seasonList) {
    out.kind = 'collection';
    out.seasonRange = [seasonList[0], seasonList[seasonList.length - 1]];
    out.seasonList = seasonList;
    out.isCompletePack = hasCompletePhrase(n);
    return out;
  }
  const rangeS = n.match(/\bs0*(\d+)\s*[-–]\s*s?0*(\d+)(?!\w)/);
  const rangeW = n.match(/seasons?\s*0*(\d+)\s*(?:(?:to|till|thru|through)\b|[-–])\s*(?:seasons?\s*)?0*(\d+)(?!\w)/);
  if (rangeS && +rangeS[2] !== +rangeS[1] && saneRangeEnd(rangeS[2])) {
    out.kind = 'collection';
    out.seasonRange = [+rangeS[1], +rangeS[2]];
    out.isCompletePack = hasCompletePhrase(n);
    return out;
  }
  if (rangeW && +rangeW[2] !== +rangeW[1] && saneRangeEnd(rangeW[2])) {
    out.kind = 'collection';
    out.seasonRange = [+rangeW[1], +rangeW[2]];
    out.isCompletePack = hasCompletePhrase(n);
    return out;
  }
  const movieSignals = movieSignalsOf(n);
  if (!hasSeasonAnchor(n) && !movieSignals && (hasCompletePhrase(n) || /\bcomplete\b/i.test(n))) {
    out.kind = 'collection';
    out.isCompletePack = true;
    return out;
  }

  // ── 2. EPISODE ─────────────────────────────────────────────────────────
  const seWordCross = n.match(/season\s*0*(\d+)\s*(?:episodes?|eps?)\s*0*(\d+)\s*(?:(?:to|till|thru|through)\b|[-–])\s*season\s*0*(\d+)\s*(?:episodes?|eps?)\s*0*(\d+)/i);
  if (seWordCross) {
    out.kind = 'episode_collection';
    out.season = +seWordCross[1];
    out.episode = +seWordCross[2];
    out.seasonEnd = +seWordCross[3];
    out.episodeEnd = +seWordCross[4];
    return out;
  }
  const seWordRange = n.match(/season\s*0*(\d+)\s*(?:episodes?|eps?)\s*(?:[-–]\s*)?0*(\d+)\s*(?:(?:to|till|thru|through)\b|[-–])\s*(?:e(?:pisode|pisodes?|ps?)\s*)?0*(\d+)/i);
  if (seWordRange) {
    out.kind = 'episode_collection';
    out.season = +seWordRange[1];
    out.episode = +seWordRange[2];
    out.episodeEnd = +seWordRange[3];
    return out;
  }
  const seWord = n.match(/season\s*0*(\d+)\s*(?:episodes?|eps?)\s*(?:[-–]\s*)?0*(\d+)/i);
  if (seWord) {
    out.kind = 'episode';
    out.season = +seWord[1];
    out.episode = +seWord[2];
    return out;
  }
  const seExact = n.match(/s0*(\d+)\s*e0*(\d+)/);
  const seRangeFull = n.match(/s0*(\d+)\s*e0*(\d+)\s*(?:(?:to|till|thru|through)\b|[-–])\s*s0*(\d+)\s*e0*(\d+)/);
  if (seRangeFull) {
    out.kind = 'episode_collection';
    out.season = +seRangeFull[1];
    out.episode = +seRangeFull[2];
    out.seasonEnd = +seRangeFull[3];
    out.episodeEnd = +seRangeFull[4];
    out.isCompletePack = false;
    return out;
  }
  const seRangeEp = n.match(/s0*(\d+)\s*e0*(\d+)\s*(?:(?:to|till|thru|through)\b|[-–])\s*e?0*(\d+)/);
  if (seExact) {
    const season = +seExact[1];
    const ep = +seExact[2];
    if (seRangeEp) {
      out.kind = 'episode_collection';
      out.season = season;
      out.episode = ep;
      out.episodeEnd = +seRangeEp[3];
      out.isCompletePack = false;
      return out;
    }
    out.kind = 'episode';
    out.season = season;
    out.episode = ep;
    return out;
  }
  const epRange = n.match(/\be0*(\d+)\s*(?:(?:to|till|thru|through)\b|[-–])\s*e?0*(\d+)/)
    || n.match(/\b(?:episodes?|eps?)\s*0*(\d+)\s*(?:(?:to|till|thru|through)\b|[-–])\s*(?:(?:episodes?|eps?)\s*)?0*(\d+)/i);
  if (epRange) {
    out.kind = 'episode_collection';
    const sTok = n.match(/\bs0*(\d+)\s+(?:episodes?|eps?)\s*0*(\d+)/i);
    out.season = sTok && +sTok[2] === +epRange[1] ? +sTok[1] : null;
    if (out.season == null) out.season = bareSeasonAnchor(n);
    out.episode = +epRange[1];
    out.episodeEnd = +epRange[2];
    return out;
  }
  const epOnly = n.match(/\be0*(\d+)\b/) || n.match(/\bepisode\s*[-–]?\s*0*(\d+)\b/i) || n.match(/\beps?\s*[-–]?\s*0*(\d+)\b/i);
  if (epOnly) {
    out.kind = 'episode';
    out.season = bareSeasonAnchor(n);
    out.episode = +epOnly[1];
    return out;
  }
  const xRange = n.match(/(?<![\d.])(?<!\d )\b(\d{1,2})\s*x\s*(\d{1,3})\s*(?:(?:to|till|thru|through)\b|[-–])\s*(\d{1,2})\s*x\s*(\d{1,3})\b/);
  if (xRange && +xRange[1] >= 1 && +xRange[1] <= 60 && +xRange[3] >= 1 && +xRange[3] <= 60) {
    const ep1 = +xRange[2];
    const ep2 = +xRange[4];
    if (!(ep1 === 264 || ep1 === 265 || ep2 === 264 || ep2 === 265)) {
      out.kind = 'episode_collection';
      out.season = +xRange[1];
      out.episode = ep1;
      out.seasonEnd = +xRange[3];
      out.episodeEnd = ep2;
      return out;
    }
  }
  const xNotation = n.match(/(?<![\d.])(?<!\d )\b(\d{1,2})\s*x\s*(\d{1,3})\b/);
  if (xNotation && +xNotation[1] >= 1 && +xNotation[1] <= 60) {
    const ep = +xNotation[2];
    if (!(ep === 264 || ep === 265)) {
      out.kind = 'episode';
      out.season = +xNotation[1];
      out.episode = ep;
      return out;
    }
  }

  // ── 2.5 ANIME "Part"-EPISODE ───────────────────────────────────────────
  const partEp = n.match(/\bpart\s*\d+\s*[-–]\s*0*(\d{1,3}(?!\w))/i);
  if (partEp && +partEp[1] <= 500) {
    const partSeasonW = n.match(/season\s*0*(\d+)/);
    const partSeasonS = n.match(/\bs0*(\d+)\b/);
    const ps = partSeasonW ? +partSeasonW[1] : (partSeasonS ? +partSeasonS[1] : null);
    if (ps != null) {
      out.kind = 'episode';
      out.season = ps;
      out.episode = +partEp[1];
      return out;
    }
  }

  // ── 2.6 ANIME "Season … - N" EPISODE ────────────────────────────────────
  const seasonDashEp = n.match(/\bseason\b[^0-9]*?[-–]\s*0*(\d{1,3}(?!\w))/i);
  if (seasonDashEp && +seasonDashEp[1] <= 500) {
    out.kind = 'episode';
    out.season = bareSeasonAnchor(n);
    out.episode = +seasonDashEp[1];
    return out;
  }

  // ── 3. SEASON BATCH ────────────────────────────────────────────────────
  const seasonW = n.match(/season\s*0*(\d+)/);
  let seasonS = null;
  if (!/\be0*(\d+)\b/.test(n) && !/season\s*0*(\d+)/.test(n)) {
    seasonS = n.match(/\bs0*(\d+)\b/);
  }
  const seasonNum = seasonW ? +seasonW[1] : (seasonS ? +seasonS[1] : null);
  const partW = n.match(/\bpart\s*(?:0*(\d{1,2}))\b/i);
  const partS = n.match(/\bs0*(\d+)\s+p\s*0*(\d{1,2})(?!\w)/i);
  const partNum = partW ? +partW[1] : (partS ? +partS[2] : null);
  if (seasonNum != null && partNum != null && partNum >= 1 && partNum <= 30) {
    out.kind = 'others';
    return out;
  }
  if (seasonNum != null) {
    out.kind = 'season_batch';
    out.season = seasonNum;
    out.isCompletePack = hasCompletePhrase(n);
    return out;
  }

  // ── 4. MOVIE ───────────────────────────────────────────────────────────
  if (movieSignals) {
    out.kind = 'movie';
    return out;
  }

  // ── 5. OTHERS ──────────────────────────────────────────────────────────
  return out;
}
