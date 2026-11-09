// classifyFile / classifyFiles — per-file classification (series|movie|extra)
// plus folder-aware batch grouping.
//
// Ported 1:1 from jellysort app/classification/classifier.py, with ONE
// substitution: jellysort feeds the pipeline a `guessit` parse of the label;
// we feed the result of `_parseIntrinsic` (below) — a self-contained parse
// built entirely on the guessit-next core (extractSE/extractPair + title
// region logic). Every classifier decision after the parse is a verbatim
// port. `skip` is never emitted here (orchestrator-side; see kinds.js).

import {
  extractBareEpisodeFromName,
  extractContainedBareEpisode,
  extractPair,
  extractSeasonFromFolder,
  extractSE,
  extractYear,
  sanitizeEpisode,
  sanitizeSeason,
} from './se.js';
import {
  extraType,
  inferKind,
  looksLikeExtra,
  looksLikeSample,
  sampleMarkerHit,
} from './kinds.js';
import {
  EP_ONLY_S_RE,
  EP_ONLY_WORD_RE,
  FOREIGN_EPISODE_RE,
  FRANCHISE_MOVIE_MARKER_RE,
  MOVIE_MARKER_RE,
  SEASON_DASH_EPISODE_RE,
  SEASON_EPISODE_TOKEN_RE,
  SEASON_WORD_DASH_EPISODE_RE,
  SEASON_WORD_EPISODE_RE,
  X_NOTATION_RE,
} from './patterns.js';
import {
  applyTitleAlias,
  bundleShowTitleFromContainer,
  cleanSourceFolderName,
  extractEpisodeTitle,
  extractFolderAltTitle,
  extractSeriesAlias,
  extractTitle,
  getFolderTitle,
  hasContainerEpisodeContext,
  isFullerTitle,
  isGenericExtraTitle,
  isGenericFolderTitle,
  normalizeTitleKey,
  shouldUseFolderTitle,
  splitForeignEpisodeTitle,
  containerIsMovieFolder,
} from './titles.js';

function candidateLabel(candidate) {
  return candidate.relative_path || candidate.name || '';
}

function num(v) {
  if (v == null) return null;
  const n = parseInt(v, 10);
  return Number.isNaN(n) ? null : n;
}

function stemOf(name) {
  const b = String(name || '').split('/').pop().split('\\').pop();
  const dot = b.lastIndexOf('.');
  return dot > 0 ? b.slice(0, dot) : b;
}

// All matches with indices (d flag) — shared patterns carry no /g flag.
function all(re, s) {
  return [...String(s).matchAll(new RegExp(re.source, 'gid'))];
}

// ─── intrinsic parse (the guessit-replacement) ─────────────────────────────

// The parse jellysort got from guessit: { type, series, title, movie,
// episode_title, alternative_title, year, season, episode }. Built from the
// core + filename title-region logic. Everything downstream (titles.js,
// kinds.js) treats it as opaque input — same shape, same reads.
export function parseIntrinsic(label) {
  const s = String(label || '');
  const raw = stemOf(s);
  const pair = extractPair(s);
  const struct = extractSE(s);
  const year = extractYear(s);

  const season = pair.season != null ? pair.season : (struct.season != null ? struct.season : null);

  // Episode only ever comes from an EXPLICIT signal. The structure layer's
  // last-resort bare-number fallback ("3 Fools (2009)" → episode 3) must not
  // leak into the guessit-shaped parse — movies keep their leading digits.
  const explicitEpisodeSignal = /s\d{1,2}\s*e\d{1,3}|(?:^|[^a-z0-9])e\d{1,3}(?:v\d+)?|\bepisodes?\b|\bepisode\b|episodio|capitulo|capitolo|capítulo|chapitre|épisode|kapitel|\bseries\s+\d{1,3}\b|part\s*\d+\s*[-–]\s*\d{1,3}/i.test(s);

  // Dash-separated trailing 2-digit number ("Show - 05", "Velvet Prince! - 05"):
  // guessit reads these as episode. Only when the core found no episode and
  // the number is 2-digit, not a year/resolution, not glued to 'p'.
  let guessEpisode = null;
  if (pair.episode == null) {
    const m = raw.match(/[^a-z0-9]-\s*(\d{1,2})(?![a-z0-9])/i);
    if (m) {
      const v = parseInt(m[1], 10);
      const after = raw.slice(m.index + m[0].length, m.index + m[0].length + 2);
      if (v >= 1 && v <= 99 && v !== year && !/^p\d?/i.test(after)
        && ![480, 576, 720, 1080, 2160].includes(v)) {
        guessEpisode = v;
      }
    }
  }
  let episode = pair.episode != null ? pair.episode : (explicitEpisodeSignal ? struct.episode : null);
  // Explicit e-markers that the sane cap rejects (E00 specials) still carry an
  // episode number — guessit keeps them, the structure layer's 1..500 cap does not.
  if (episode == null && explicitEpisodeSignal) {
    const em = raw.match(/s\d{1,2}\s*e(\d{1,3})/i) || raw.match(/(?:^|[^a-z0-9])e(\d{1,3})/i);
    if (em) episode = parseInt(em[1], 10);
  }
  if (episode == null) episode = guessEpisode;
  if (year != null && episode === year) episode = null;
  const effectiveEpisode = episode;

  const marker = findIntrinsicMarker(raw, s, season, episode, effectiveEpisode, pair.episode);
  let titleRegion = raw;
  let episodeRegion = null;
  let markerExplicit = false;
  if (marker) {
    markerExplicit = marker.explicit;
    const pre = raw.slice(0, marker.start);
    const post = raw.slice(marker.end);
    const preText = pre.replace(/^[^a-z0-9]+/i, '');
    if (preText) {
      titleRegion = pre;
      episodeRegion = post;
    } else {
      titleRegion = post;
      episodeRegion = post;
    }
  }
  titleRegion = stripLeadingPath(titleRegion);

  const { title: baseTitle, alias } = splitTitleAlias(titleRegion);
  // guessit puts a `series` on explicit S/E names only; a loose bare-number
  // ("Show - 05") gets a title but never a series.
  const series = markerExplicit ? baseTitle : null;
  const movie = series;
  const episodeTitleRaw = episodeRegion != null ? cleanEpisodeTail(episodeRegion) : null;

  const type = (season != null || effectiveEpisode != null || struct.episode != null) ? 'episode' : 'movie';

  return {
    type,
    year,
    season: season != null ? season : null,
    episode: effectiveEpisode,
    series,
    title: baseTitle,
    movie,
    episode_title: episodeTitleRaw,
    alternative_title: alias,
  };
}

// First valid S/E marker in the label, with year/resolution/codec guards.
// A marker only counts when it is consistent with what the core found (so
// "RIFT_2045" / "Season 1 - 720p" / "S02 - 2019" never split the title).
function findIntrinsicMarker(raw, label, season, episode, effectiveEpisode, pairEpisode) {
  const candidates = [];
  const pushForm = (regex, pick) => {
    for (const m of all(regex, raw)) {
      if (pick && pick(m, raw)) continue;
      const se = num(m.groups ? m.groups.season : null);
      const ep = num(m.groups ? m.groups.episode : null);
      // Without any core season/episode every explicit marker counts; with
      // core values the form must agree with what the core resolved.
      const consistent = (season == null && episode == null)
        ? effectiveEpisode == null || ep == null || ep === effectiveEpisode
        : (se == null || se === season || episode == null) && (ep == null || ep === episode || season == null);
      if (!consistent) continue;
      candidates.push({ start: m.index, end: m.index + m[0].length, explicit: true });
    }
  };
  pushForm(SEASON_EPISODE_TOKEN_RE, null);
  pushForm(/(?<![a-z0-9])s(?<season>\d{1,2})\s+e(?<episode>\d{1,3})(?:v\d+)?(?![a-z0-9])/gi, null);
  pushForm(SEASON_DASH_EPISODE_RE, isDashRejected);
  pushForm(SEASON_WORD_DASH_EPISODE_RE, isDashRejected);
  pushForm(SEASON_WORD_EPISODE_RE, null);
  pushForm(X_NOTATION_RE, isXRejected);
  pushForm(FOREIGN_EPISODE_RE, null);
  pushForm(EP_ONLY_S_RE, null);
  pushForm(EP_ONLY_WORD_RE, null);
  // Bare dash-episode guess: only when the core found nothing at all.
  for (const m of all(/(?:^|[^a-z0-9])-\s*(\d{1,2})(?![a-z0-9])/i, raw)) {
    if (season != null || pairEpisode != null) break;
    const v = parseInt(m[1], 10);
    if (v >= 1 && v <= 99) candidates.push({ start: m.index, end: m.index + m[0].length, explicit: false });
  }
  if (!candidates.length) return null;
  candidates.sort((a, b) => a.start - b.start);
  return candidates[0];
}

function isDashRejected(m, raw) {
  const epText = m.groups.episode;
  const tail = raw[m.indices.groups.episode[1]] || '';
  if (epText.length >= 3 && /\d/.test(tail)) return true;
  if (epText.length === 4) return true;
  const after = raw.slice(m.index + m[0].length, m.index + m[0].length + 8);
  if (/^\s*(?:480|576|720|1080|2160)p?\b/i.test(after)) {
    if (['480', '576', '720', '1080', '2160'].includes(epText)) return true;
  }
  return false;
}

function isXRejected(m, raw) {
  const season = num(m.groups.season);
  const episode = num(m.groups.episode);
  if (!(season >= 1 && season <= 60)) return true;
  if (episode === 264 || episode === 265) return true;
  const before = raw.slice(Math.max(0, m.index - 5), m.index);
  if (/\d{3,4}\s*$/.test(before)) return true;
  return false;
}

function stripLeadingPath(region) {
  const slash = Math.max(String(region).lastIndexOf('/'), String(region).lastIndexOf('\\'));
  return slash >= 0 ? String(region).slice(slash + 1) : region;
}

// Split "Show Name - Future Arc" into title + alias (guessit alternative_title).
function splitTitleAlias(region) {
  let r = String(region || '').trim();
  const dash = r.search(/\s+[-–]\s+/);
  if (dash === -1) return { title: foldTitle(r), alias: null };
  const left = r.slice(0, dash).trim();
  const right = r.slice(dash).replace(/^[\s\-–]+\s*/, '').trim();
  if (!left || !right) return { title: foldTitle(r), alias: null };
  if (/^(season|s\d)/i.test(right) || /\b(?:19|20)\d{2}\b/.test(right)) {
    return { title: foldTitle(r), alias: null };
  }
  if (/[a-z]/i.test(right)) return { title: foldTitle(left), alias: foldTitle(right) };
  return { title: foldTitle(r), alias: null };
}

function stripTechParenTails(t) {
  let s = String(t);
  const tech = /\s*\([^)]*\b(?:\d{3,4}p|web[- ]?dl|amzn|nf\b|x26[45]|hevc|av1|blu[- ]?ray|bdr?rip|hdtv|proper|flac|eac3|aac\d*|ac3|opus|dd[\d.+\-]*|dual[- ]?audio)[^)]*\)\s*$/i;
  while (tech.test(s)) s = s.replace(tech, ' ');
  return s;
}

// Timeline generously: an all-caps language/audio trailing run (ITA ENG JPN
// SUB ITA ...) past a release marker is junk; fold it.
function foldTitle(region) {
  let t = String(region || '');
  t = t.replace(/\[[^\]]*\]/g, ' ');
  t = t.replace(/\s*\(\s*(?:19|20)\d{2}\s*\)/g, ' ');
  t = t.replace(/\b(?:19|20)\d{2}\b/g, ' ');
  t = stripTechParenTails(t);
  const hard = t.search(
    /\bx26[45]\b|\b(?:hevc|av1|web[- ]?dl|web[- ]?rip|blu[- ]?ray|bdrip|brrip|hdtv|dvdrip|remux|hdrip|\d{3,4}p|flac|eac3|aac\d*|ac3|opus|dd[\d.+\-]*|dts|hdma)\b|\b10[- ]?bit\b|\b(?:dual[- ]?audio|multi-?subs?|subbed|rlsgrp|fakesite)\b/i,
  );
  if (hard !== -1) t = t.slice(0, hard);
  t = t.replace(/[._]+/g, ' ');
  t = t.replace(/\s+/g, ' ');
  t = t.replace(/^[\s\-–—]+/, '');
  t = t.replace(/[\s\-–—]+$/, '');
  t = t.replace(/\s+/g, ' ').trim();
  return t || null;
}

// Episode-title region after an S/E marker: drop leading range residue and
// any tail that is release junk only.
function cleanEpisodeTail(region) {
  let t = String(region || '');
  t = t.replace(/^[\s\-–—]+/, '');
  t = t.replace(/^e\d{1,3}(?:\s*(?:to|till|thru|through)\b\s*\d{1,3})?/i, '');
  t = t.replace(/^\d{1,3}(?:\s*(?:to|till|thru|through)\b\s*\d{1,3})?\s*[-–]?\s*/i, '');
  t = t.replace(/^0*\d{1,3}\s*[-–]\s*/i, '');
  t = t.replace(/\[[^\]]*\]/g, ' ');
  t = t.replace(/\s*\(\s*(?:19|20)\d{2}\s*\)/g, ' ');
  t = t.replace(/\b(?:19|20)\d{2}\b/g, ' ');
  t = stripTechParenTails(t);
  const hard = t.search(
    /\bx26[45]\b|\b(?:hevc|av1|web[- ]?dl|web[- ]?rip|blu[- ]?ray|bdrip|brrip|hdtv|dvdrip|remux|hdrip|\d{3,4}p|flac|eac3|aac\d*|ac3|opus|dd[\d.+\-]*|dts|hdma)\b|\b10[- ]?bit\b|\b(?:dual[- ]?audio|multi-?subs?|subbed|rlsgrp|fakesite)\b/i,
  );
  if (hard !== -1) t = t.slice(0, hard);
  t = t.replace(/[._]+/g, ' ');
  t = t.replace(/\s+/g, ' ').trim();
  t = t.replace(/[\s\-–—]+$/, '');
  t = t.replace(/^[\s\-–—]+/, '');
  if (!t || t.split(' ').length < 2 || !/[a-z]/i.test(t)) return null;
  return t;
}

// ─── jellysort classifier.py port ─────────────────────────────────────────

function extendsFrom(value, ...cands) {
  return cands.reduce((a, c) => a || c, value);
}

function hasMovieMarker(value) {
  return MOVIE_MARKER_RE.test(String(value || '')) || FRANCHISE_MOVIE_MARKER_RE.test(String(value || ''));
}

function candidateHasMovieMarker(candidate) {
  if (hasMovieMarker(candidateLabel(candidate))) return true;
  if (candidate.container_path && hasMovieMarker(String(candidate.container_path).split('/').pop())) return true;
  return false;
}

function extractMovieMarkerNumberText(value) {
  let m = MOVIE_MARKER_RE.exec(String(value || ''));
  if (m) {
    const digits = (m[0].match(/\d{1,3}/) || [])[0];
    return digits || null;
  }
  m = FRANCHISE_MOVIE_MARKER_RE.exec(String(value || ''));
  if (m) {
    const d = (m[0].match(/m(\d{1,2})/i) || [])[1];
    return d || null;
  }
  return null;
}

function extractMovieMarkerTitle(candidate, title) {
  const c = candidate || {};
  if (c.container_path) {
    const containerName = String(c.container_path).split('/').pop() || '';
    if (containerName && containerName !== String(c.source_root || '').split('/').pop() && hasMovieMarker(containerName)) {
      return cleanSourceFolderName(containerName) || title;
    }
  }
  if (!title) return null;
  if (/\d/.test(String(title))) return title;
  const number = extractMovieMarkerNumberText(candidateLabel(c));
  if (number != null) return `${String(title)} ${number}`.trim();
  return title;
}

export function classifyFile(candidate, opts = {}) {
  const aliases = opts.seriesAliases || null;
  const label = candidateLabel(candidate);
  const parsed = parseIntrinsic(label);
  const containerBaseName = String(candidate && candidate.container_path ? candidate.container_path : '').split('/').pop() || '';

  let title = extractTitle(parsed, candidate);
  const [foreignTitle, foreignEpisode, foreignEpisodeTitle] = splitForeignEpisodeTitle(title);
  title = foreignTitle;
  let episodeTitle = extractEpisodeTitle(parsed, candidate);
  [title, episodeTitle] = applyTitleAlias(title, episodeTitle, aliases || {});
  if (foreignEpisodeTitle && (!episodeTitle || /episodio|episode|capitulo|capitolo|capítulo|chapitre|épisode|kapitel|series/i.test(episodeTitle || ''))) {
    episodeTitle = foreignEpisodeTitle;
  }
  let seriesAlias = extractSeriesAlias(parsed, title);
  let year = num(parsed.year);

  let season = sanitizeSeason(num(parsed.season), year);
  let episode = sanitizeEpisode(num(parsed.episode), year);
  const pairFallback = extractPair(label);
  const fallbackSeason = sanitizeSeason(pairFallback.season, year);
  const fallbackEpisode = sanitizeEpisode(pairFallback.episode, year);
  let hasExplicitEpisode = fallbackEpisode != null;
  if (fallbackSeason != null) season = fallbackSeason;
  if (fallbackEpisode != null) {
    episode = fallbackEpisode;
    hasExplicitEpisode = true;
  }

  let seasonFromFolder = false;
  if (season == null) {
    season = sanitizeSeason(num(extractSeasonFromFolder(candidate)), year);
    seasonFromFolder = season != null;
  }
  if (episode == null && seasonFromFolder) {
    const be = num(extractBareEpisodeFromName(candidate.name));
    episode = sanitizeEpisode(be, year);
    hasExplicitEpisode = episode != null;
  }
  if (episode == null && hasContainerEpisodeContext(candidate) && !containerIsMovieFolder(candidate)) {
    const ce = num(extractContainedBareEpisode(candidate.name));
    episode = sanitizeEpisode(ce, year);
    hasExplicitEpisode = episode != null;
  }
  if (episode == null && foreignEpisode != null) {
    episode = sanitizeEpisode(foreignEpisode, year);
    hasExplicitEpisode = episode != null;
  }
  season = sanitizeSeason(season, year);
  episode = sanitizeEpisode(episode, year);

  const struct = extractSE(label);
  const episodeEnd = struct.episodeEnd != null ? struct.episodeEnd : null;

  let { kind, confidence, reason } = inferKind(label, parsed, season, episode, hasExplicitEpisode);
  if (!hasExplicitEpisode && (kind === 'series' || kind === 'movie') && candidateHasMovieMarker(candidate)) {
    const movieMarkerTitle = extractMovieMarkerTitle(candidate, title);
    if (movieMarkerTitle) {
      title = movieMarkerTitle;
      season = null;
      episode = null;
      kind = 'movie';
      confidence = Math.max(confidence, 0.85);
      reason = 'Detected franchise movie marker';
    }
  }

  const folderTitle = getFolderTitle(candidate);
  let extraTypeValue = null;
  const episodeTitleForExtra = parsed.episode_title;
  if (looksLikeExtra(label, episodeTitleForExtra)) {
    extraTypeValue = extraType(label, episodeTitleForExtra);
  }
  if (extraTypeValue && hasExplicitEpisode && folderTitle && !isGenericFolderTitle(folderTitle)) {
    const folderWords = new Set((normalizeTitleKey(folderTitle).split(' ')).filter(Boolean));
    const m = /(ncop\d*(?:v\d+)?|nced\d*(?:v\d+)?|op\d*(?:v\d+)?|ed\d*(?:v\d+)?|sp\d*(?:v\d+)?|ova|ona|special|extras?|featurettes?|bonus|recap|trailer)/i.exec(label);
    if (m && folderWords.has(String(m[0]).toLowerCase())) {
      const hasExtraFolder = /(^|\/)(NC|extras?|special|ova|ona)($|\/|\\)/i.test(label);
      if (!hasExtraFolder) {
        if (!/S\d{1,2}E\d{1,3}.*\b(OP|ED|NCOP|NCED)\b/i.test(label)) {
          extraTypeValue = null;
        }
      }
    }
  }
  if (extraTypeValue && (kind === 'series' || kind === 'movie')) {
    kind = 'extra';
    confidence = Math.max(confidence, 0.85);
    reason = `Detected ${extraTypeValue} extra/special marker`;
  }

  if (folderTitle && (kind === 'series' || kind === 'extra')) {
    if (!isGenericFolderTitle(folderTitle) && shouldUseFolderTitle(folderTitle, title)) {
      if (isGenericExtraTitle(title) || isFullerTitle(folderTitle, title)) {
        title = folderTitle;
        if (year == null) {
          // The folder title strips the trailing "(year)" paren — fall back to
          // the raw container name so the year is still recovered from it.
          const ym = /\((19\d{2}|20\d{2})\)/.exec(folderTitle)
            || /\((19\d{2}|20\d{2})\)/.exec(containerBaseName);
          if (ym) {
            const parsedYear = parseInt(ym[1], 10);
            if (!Number.isNaN(parsedYear)) year = parsedYear;
          }
        }
      }
    }
  }

  if (!seriesAlias && (kind === 'series' || kind === 'extra')) {
    const folderAlias = extractFolderAltTitle(candidate);
    if (folderAlias && normalizeTitleKey(folderAlias) !== normalizeTitleKey(title)) seriesAlias = folderAlias;
  }

  const bundleTitle = bundleShowTitleFromContainer(candidate);
  if (bundleTitle) {
    title = bundleTitle;
    if ((kind === 'series' || kind === 'movie') && String(candidate.relative_path || '').includes('/')) {
      kind = 'extra';
      confidence = Math.max(confidence, 0.85);
      reason = 'Bundle container extras';
    }
    if (kind === 'extra' && !extraTypeValue) extraTypeValue = 'special';
  }

  if (kind === 'movie' && sampleMarkerHit(label, parsed.title, parsed.episode_title)) {
    kind = 'extra';
    extraTypeValue = 'sample';
    confidence = Math.max(confidence, 0.85);
    reason = 'Detected sample extra';
  } else if (kind === 'movie' && looksLikeSample(label, parsed.title, parsed.episode_title, candidate.file_size)) {
    reason = `${reason || ''} (small file; sample-size suspect)`;
  }

  if (kind === 'movie') {
    season = null;
    episode = null;
  }

  return {
    type: kind,
    title,
    episode_title: episodeTitle,
    series_alias: seriesAlias,
    year,
    season,
    episode,
    episodeEnd,
    confidence,
    reason,
    extra_type: extraTypeValue,
  };
}

// ─── batch (classifyFiles) ────────────────────────────────────────────────

function groupKey(candidate) {
  return candidate.container_path || candidate.source_path;
}

function normKey(title) {
  return normalizeTitleKey(title || '');
}

function round2(v) {
  return Math.round(v * 100) / 100;
}

function summarizeGroup(key, results) {
  const fileCount = results.length;
  const episodeFileCount = results.filter((r) => r.episode != null).length;
  const extraFileCount = results.filter((r) => r.type === 'extra').length;

  const identity = results.filter((r) => r.type === 'series' || r.type === 'movie');
  const counts = new Map();
  for (const r of identity) {
    const k = `${normKey(r.title)}|${r.type}`;
    counts.set(k, (counts.get(k) || 0) + 1);
  }
  let majorityTitle = null;
  let majorityKey = null;
  let majorityType = null;
  let majorityCount = -1;
  for (const [k, count] of counts) {
    if (count > majorityCount) {
      const sep = k.lastIndexOf('|');
      majorityKey = k.slice(0, sep).trim();
      majorityTitle = majorityKey;
      majorityType = k.slice(sep + 1);
      majorityCount = count;
    }
  }
  if (majorityKey === null) {
    majorityTitle = identity.length ? (identity[0].title || null) : null;
    majorityType = identity.length ? identity[0].type : 'extra';
    majorityKey = normKey(majorityTitle);
  } else {
    // surface a real (non-normalized) title for the majority
    const first = identity.find((r) => normKey(r.title) === majorityKey && r.type === majorityType);
    if (first && first.title) majorityTitle = first.title;
  }

  const seasons = [];
  const bySeason = new Map();
  for (const r of results) {
    if (r.type !== 'series' || r.season == null) continue;
    if (!seasons.includes(r.season)) seasons.push(r.season);
    if (!bySeason.has(r.season)) bySeason.set(r.season, []);
    if (r.episode != null && !bySeason.get(r.season).includes(r.episode)) bySeason.get(r.season).push(r.episode);
  }
  seasons.sort((a, b) => a - b);
  for (const list of bySeason.values()) list.sort((a, b) => a - b);
  const episodesBySeason = {};
  for (const [s, list] of bySeason) episodesBySeason[String(s)] = list;

  const conflicts = [];
  let consistent = true;
  const disagreeing = [];
  for (const r of identity) {
    if (normKey(r.title) === majorityKey && r.type === majorityType) continue;
    consistent = false;
    conflicts.push(`${majorityTitle} vs ${r.title || r.type}`);
    disagreeing.push(r);
  }
  for (const r of disagreeing) {
    r.confidence = round2(Math.min(0.8, r.confidence - 0.1));
    r.reason = `${r.reason || ''} (conflict: ${conflicts[conflicts.length - 1]})`;
  }

  return {
    key,
    title: majorityTitle,
    type: majorityType,
    seasons,
    episodesBySeason,
    fileCount,
    episodeFileCount,
    extraFileCount,
    consistent,
    conflicts,
  };
}

export function classifyFiles(candidates, opts = {}) {
  const results = [];
  const order = [];
  const groupsByKey = new Map();
  for (const candidate of candidates || []) {
    const r = classifyFile(candidate, opts);
    results.push(r);
    const key = groupKey(candidate);
    if (!groupsByKey.has(key)) {
      groupsByKey.set(key, []);
      order.push(key);
    }
    groupsByKey.get(key).push(r);
  }
  const groups = [];
  for (const key of order) {
    groups.push(summarizeGroup(key, groupsByKey.get(key)));
  }
  return { results, groups };
}