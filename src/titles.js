// Title extraction from file+folder names. Ported 1:1 from jellysort
// app/classification/titles.py (which has zero guessit dependence — it only
// uses candidate paths + patterns). `parsed` is the guessit-shaped object
// produced by classifyFile._parseIntrinsic — every field read here is
// { series, title, movie, episode_title, alternative_title, year, type,
//   season, episode }.

import {
  BUNDLE_DECL_WORDS,
  BUNDLE_EP_RANGE_RE,
  BUNDLE_EXTRA_SIGNALS_RE,
  CRC_BRACKETS_RE,
  CRC_PAREN_RE,
  EXTRA_MARKERS,
  FILENAME_EP_TITLE_RE,
  FOREIGN_EPISODE_RE,
  LEADING_BRACKET_RE,
  SEASON_DASH_EPISODE_RE,
  SEASON_EPISODE_RE,
  SEASON_EPISODE_TOKEN_RE,
  SEASON_FOLDER_RE,
  SEASON_MARKER_RE,
  SEASON_PLUS_TEXT_RE,
  SEASON_WORD_DASH_EPISODE_RE,
  TECH_TAG_RE,
  TRAILING_BRACKET_RE,
  TRAILING_GROUP_RE,
  TRAILING_PAREN_TECH_RE,
} from './patterns.js';
import { GENERIC_EXTRA_SET } from './kinds.js';
import { extractContainedBareEpisode, extractContainedBareEpisodeTitle } from './se.js';

function base(name) {
  const b = String(name || '').split('/').pop().split('\\').pop();
  return b;
}

function stemOf(name) {
  const b = base(name);
  const dot = b.lastIndexOf('.');
  return dot > 0 ? b.slice(0, dot) : b;
}

export function normalizeTitleKey(value) {
  return (String(value || '').toLowerCase().match(/[a-z0-9]+/g) || []).join(' ');
}

export function splitForeignEpisodeTitle(title) {
  if (!title) return [title, null, null];
  const m = FOREIGN_EPISODE_RE.exec(String(title));
  if (!m) return [title, null, null];
  const seriesPart = String(title).slice(0, m.index).trim().replace(/^[-._ ]+|[-._ ]+$/g, '');
  const afterPart = String(title).slice(m.index + m[0].length).trim().replace(/^[-._ ]+|[-._ ]+$/g, '');
  const series = seriesPart || title;
  const episodeTitle = afterPart || null;
  return [series, parseInt(m[1], 10), episodeTitle];
}

export function applyTitleAlias(title, episodeTitle, aliases) {
  if (!aliases || !title) return [title, episodeTitle];
  const titleKey = normalizeTitleKey(title);
  let canonical = null;
  for (const [alias, mapped] of Object.entries(aliases)) {
    if (titleKey && normalizeTitleKey(alias) === titleKey) {
      canonical = String(mapped).trim();
      break;
    }
  }
  if (!canonical) return [title, episodeTitle];
  if (episodeTitle && titleKey === normalizeTitleKey(episodeTitle)) return [canonical, canonical];
  return [canonical, episodeTitle];
}

export function isSeriesAliasText(value, title) {
  const cleaned = String(value || '').trim();
  if (!cleaned || !/[a-z]/i.test(cleaned)) return false;
  if (isGenericExtraTitle(cleaned)) return false;
  if (isFillerEpisodeTitle(cleaned)) return false;
  if (SEASON_EPISODE_RE.test(cleaned)) return false;
  if (SEASON_EPISODE_TOKEN_RE.test(cleaned)) return false;
  if (SEASON_DASH_EPISODE_RE.test(cleaned)) return false;
  if (SEASON_WORD_DASH_EPISODE_RE.test(cleaned)) return false;
  return normalizeTitleKey(cleaned) !== normalizeTitleKey(title || '');
}

// Filler episode-title tokens ("Episode 1", "ep 01") are never real titles:
// they usually mean the file embeds nothing but markers + a generic label.
export function isFillerEpisodeTitle(value) {
  return /^ep(?:isode)?\s*\d+$/i.test(String(value || '').trim());
}

export function extractSeriesAlias(parsed, title) {
  const alternativeTitle = parsed.alternative_title;
  const candidates = [];
  if (typeof alternativeTitle === 'string') candidates.push(alternativeTitle.trim());
  else if (Array.isArray(alternativeTitle)) {
    for (const item of alternativeTitle) {
      if (typeof item === 'string') candidates.push(item.trim());
    }
  }
  for (const cleaned of candidates) {
    if (isSeriesAliasText(cleaned, title)) return cleaned;
  }
  return null;
}

export function _hasAlpha(value) {
  return /[a-z]/i.test(String(value || ''));
}

export function isFullerTitle(candidateTitle, parsedTitle) {
  if (!candidateTitle || !parsedTitle) return false;
  const candidateWords = new Set((String(candidateTitle).toLowerCase().match(/[a-z0-9]+/g) || []));
  const parsedWords = new Set((String(parsedTitle).toLowerCase().match(/[a-z0-9]+/g) || []));
  if (!parsedWords.size) return false;
  for (const w of parsedWords) {
    if (!candidateWords.has(w)) return false;
  }
  if (String(candidateTitle).length <= String(parsedTitle).length) return false;
  for (const word of candidateWords) {
    if (parsedWords.has(word)) continue;
    if (/^\d+$/.test(word) && !(word.length === 4 && /^(19|20)\d{2}$/.test(word))) return false;
  }
  return true;
}

function isYearWord(word) {
  return word.length === 4 && /^\d{4}$/.test(word) && Number(word) >= 1900 && Number(word) <= 2100;
}

export function isGenericExtraTitle(value) {
  if (!value) return false;
  const norm = normalizeTitleKey(value);
  if (!norm) return false;
  if (GENERIC_EXTRA_SET.has(norm)) return true;
  if (/^(ncop|nced|op|ed|sp)\d*(?:v\d+)?$/i.test(norm)) return true;
  if (EXTRA_MARKERS.test(value) && norm.split(' ').length === 1 && norm.length <= 4) return true;
  return false;
}

export function isGenericFolderTitle(value) {
  if (!value) return true;
  const norm = normalizeTitleKey(value);
  if (!norm) return true;
  if (GENERIC_EXTRA_SET.has(norm)) return true;
  if (SEASON_FOLDER_RE.test(value)) {
    const stripped = String(value).replace(SEASON_FOLDER_RE, '').trim().replace(/^[-._ ]+|[-._ ]+$/g, '');
    if (!stripped || normalizeTitleKey(stripped).split(' ').length <= 1) return true;
  }
  if (EXTRA_MARKERS.test(value) && norm.split(' ').length === 1) return true;
  if (norm.length <= 2 && !/[a-z]{3,}/i.test(norm)) return true;
  return false;
}

export function cleanSourceFolderName(rawName) {
  let cleaned = String(rawName || '').replace(LEADING_BRACKET_RE, '');
  while (TRAILING_BRACKET_RE.test(cleaned)) cleaned = cleaned.replace(TRAILING_BRACKET_RE, '');
  cleaned = cleaned.replace(TRAILING_GROUP_RE, '');
  return cleaned.trim().replace(/^[-._ ]+|[-._ ]+$/g, '') || null;
}

// Shared scrub: leading [Group], trailing [tech], trailing group, trailing
// paren-tech, " - Complete ..." descriptive tail (EIDOLON-style containers).
function scrubContainerName(rawName) {
  let cleaned = String(rawName || '').replace(LEADING_BRACKET_RE, '');
  while (TRAILING_BRACKET_RE.test(cleaned)) cleaned = cleaned.replace(TRAILING_BRACKET_RE, '');
  cleaned = cleaned.replace(TRAILING_PAREN_TECH_RE, '');
  cleaned = cleaned.replace(TRAILING_GROUP_RE, '');
  cleaned = cleaned.replace(/\s*[-–]\s*Complete\b.*$/i, '');
  while (TRAILING_BRACKET_RE.test(cleaned)) cleaned = cleaned.replace(TRAILING_BRACKET_RE, '');
  return cleaned;
}

export function extractSeriesFromSource(candidate) {
  const c = candidate || {};
  let pathStr = c.container_path || null;
  if (!pathStr) {
    const sp = String(c.source_path || '');
    const slash = sp.lastIndexOf('/');
    const parent = slash > 0 ? sp.slice(0, slash) : '';
    if (parent && parent !== String(c.source_root || '')) pathStr = parent;
  }
  if (!pathStr) return null;
  let cleaned = scrubContainerName(pathStr.split('/').pop() || '');
  // Strip trailing collection/description like " - Complete SUPERMAN Prequel
  // TV Series, Season 1-2 S01-S02" (already handled above for "- Complete",
  // then the season marker splits "Season 1-2 S01-S02" tails).
  const parts = cleaned.split(SEASON_MARKER_RE);
  if (parts.length > 1) {
    const result = finalizeSeriesTitle(parts[0]);
    if (result) return result;
  }
  const original = cleaned;
  cleaned = cleaned.replace(SEASON_PLUS_TEXT_RE, '').trim();
  const anyChange = cleaned !== original;
  const techParts = cleaned.split(TECH_TAG_RE);
  if (techParts.length > 1) {
    const result = finalizeSeriesTitle(techParts[0]);
    if (result) return result;
  }
  if (anyChange) {
    const trimmed = finalizeSeriesTitle(cleaned);
    if (trimmed) return trimmed;
  }
  return null;
}

// Folder-derived titles get the decorative tails trimmed to the primary name:
// trailing "(2018-2019)"/" (2021)" year parens are dropped entirely, and a
// trailing "(Alt Title)" parenthetical (anime JP-primary/fansub containers)
// is only split off when the folder also declares a season marker — the alt
// is surfaced as series_alias by extractFolderAltTitle below.
function finalizeSeriesTitle(value) {
  let t = String(value || '').trim().replace(/^[-._ ]+|[-._ ]+$/g, '');
  if (!t) return null;
  t = t.replace(/\s*\((?:19\d{2}|20\d{2})(?:\s*[-–]\s*(?:19\d{2}|20\d{2}|\d{2}))?\)\s*$/i, '').trim();
  if (!t) return null;
  const m = /^(.*?)\s*\(([^()]*)\)\s*$/.exec(t);
  if (m) {
    const primary = m[1].trim();
    const alt = m[2].trim();
    if (primary && alt && /[a-z]/i.test(alt)
      && !/\b(?:19|20)\d{2}\b/.test(alt)
      && !/(\b\d{3,4}p\b|blu[- ]?ray|web[- ]?dl|web[- ]?rip|hdtv|bdrip|x26[45]|hevc|av1|flac|aac|eac3|opus|dd[\d.+\-]*)|\b[a-z]{3,4}\d{3,4}p\b/i.test(alt)
      && normalizeTitleKey(primary) !== normalizeTitleKey(alt)) {
      t = primary.trim();
    }
  }
  return t || null;
}

// The "(Alt Title)" of a season-declared anime folder (JP primary in parens):
// "Lamprey Crown Monogatari (Rotate Seagull) (Season 02)" → "Rotate Seagull".
export function extractFolderAltTitle(candidate) {
  const c = candidate || {};
  if (!c.container_path) return null;
  if (!hasContainerEpisodeContext(c)) return null;
  const raw = String(c.container_path).split('/').pop() || '';
  if (!raw || !/(?:\(season\s*\d+[^)]*\)|\(s\d{1,2}\b)/i.test(raw)) return null;
  let cleaned = scrubContainerName(raw);
  const parts = cleaned.split(SEASON_MARKER_RE);
  const pre = parts.length > 1 ? parts[0].trim().replace(/^[-._ ]+|[-._ ]+$/g, '') : null;
  if (!pre) return null;
  const m = /^(.*?)\s*\(([^()]*)\)\s*$/.exec(pre);
  if (!m) return null;
  const primary = m[1].trim();
  const alt = m[2].trim();
  if (!primary || !alt || !/[a-z]/i.test(alt)) return null;
  if (/\b(?:19|20)\d{2}\b/.test(alt)) return null;
  if (/(\b\d{3,4}p\b|blu[- ]?ray|web[- ]?dl|web[- ]?rip|hdtv|bdrip|x26[45]|hevc|av1|flac|aac|eac3|opus|dd[\d.+\-]*)|\b[a-z]{3,4}\d{3,4}p\b/i.test(alt)) return null;
  if (!isSeriesAliasText(alt, primary)) return null;
  return alt;
}

export function hasContainerEpisodeContext(candidate) {
  const c = candidate || {};
  return Boolean(c.container_path && c.relative_path);
}

export function containerIsMovieFolder(candidate) {
  const c = candidate || {};
  if (!hasContainerEpisodeContext(c)) return false;
  if (extractContainedBareEpisode(c.name) === null) return false;
  const folder = cleanSourceFolderName(String(c.container_path || '').split('/').pop() || '');
  if (!folder) return false;
  const fileTokens = (String(c.name).split('/').pop().split('.').slice(0, -1).join(' ').toLowerCase().match(/[a-z0-9]+/g) || []);
  const folderTokens = (folder.toLowerCase().match(/[a-z0-9]+/g) || []);
  if (!fileTokens.length || !folderTokens.length) return false;
  if (folderTokens.length > fileTokens.length) return false;
  for (let i = 0; i < folderTokens.length; i++) {
    if (folderTokens[i] !== fileTokens[i]) return false;
  }
  return true;
}

export function extractContainerSeriesForBareEpisode(candidate) {
  const c = candidate || {};
  if (!hasContainerEpisodeContext(c)) return null;
  if (containerIsMovieFolder(c)) return null;
  if (extractContainedBareEpisode(c.name) === null) return null;
  return cleanSourceFolderName(String(c.container_path || '').split('/').pop() || '');
}

export function getFolderTitle(candidate) {
  const c = candidate || {};
  if (c.container_path) {
    const ft = extractSeriesFromSource(c);
    if (ft && !isGenericFolderTitle(ft)) return ft;
    const raw = String(c.container_path).split('/').pop() || '';
    const cleaned = cleanSourceFolderName(raw);
    if (cleaned) {
      let tmp = String(raw).replace(LEADING_BRACKET_RE, '');
      while (TRAILING_BRACKET_RE.test(tmp)) tmp = tmp.replace(TRAILING_BRACKET_RE, '');
      tmp = tmp.replace(TRAILING_PAREN_TECH_RE, '');
      tmp = tmp.replace(TRAILING_GROUP_RE, '');
      tmp = tmp.trim().replace(/^[-._ ]+|[-._ ]+$/g, '');
      if (tmp && !isGenericFolderTitle(tmp)) return tmp;
      if (cleaned && !isGenericFolderTitle(cleaned)) return cleaned;
      if (c.relative_path && String(c.relative_path).includes('/')) {
        const first = String(c.relative_path).split('/')[0];
        let f2 = String(first).replace(LEADING_BRACKET_RE, '');
        while (TRAILING_BRACKET_RE.test(f2)) f2 = f2.replace(TRAILING_BRACKET_RE, '');
        f2 = f2.replace(TRAILING_PAREN_TECH_RE, '');
        f2 = f2.replace(TRAILING_GROUP_RE, '');
        f2 = f2.trim().replace(/^[-._ ]+|[-._ ]+$/g, '');
        if (f2 && !isGenericFolderTitle(f2) && !SEASON_FOLDER_RE.test(f2)) return f2;
      }
      return cleaned;
    }
  }
  if (c.relative_path && String(c.relative_path).includes('/')) {
    const first = String(c.relative_path).split('/')[0];
    let cleaned = String(first).replace(LEADING_BRACKET_RE, '');
    while (TRAILING_BRACKET_RE.test(cleaned)) cleaned = cleaned.replace(TRAILING_BRACKET_RE, '');
    cleaned = cleaned.replace(TRAILING_PAREN_TECH_RE, '');
    cleaned = cleaned.replace(TRAILING_GROUP_RE, '');
    cleaned = cleaned.trim().replace(/^[-._ ]+|[-._ ]+$/g, '');
    if (cleaned && !isGenericFolderTitle(cleaned) && !SEASON_FOLDER_RE.test(cleaned)) return cleaned;
  }
  return null;
}

export function shouldUseFolderTitle(folderTitle, fileTitle) {
  if (/\b\d+_\d+\b/.test(String(folderTitle || ''))) {
    if (!fileTitle || !/\b\d+_\d+\b/.test(String(fileTitle))) return false;
  }
  return true;
}

export function extractTitle(parsed, candidate) {
  const c = candidate || {};
  const pathSeries = extractSeriesFromSource(c);
  const containerSeries = extractContainerSeriesForBareEpisode(c);
  if (containerSeries) return containerSeries;
  if (pathSeries && c.container_path) {
    if (parsed.type === 'episode' && !parsed.series) {
      if (/\b\d+_\d+\b/.test(pathSeries)) {
        // numeric-junk folder (7_9) — let the file title win
      } else {
        const fileTitle = parsed.title || parsed.movie || '';
        if (isFullerTitle(pathSeries, fileTitle) || !String(fileTitle).trim()) return pathSeries;
        if (String(fileTitle).trim().split(' ').length <= 2
          && !String(fileTitle).trim().toLowerCase().includes(String(pathSeries).toLowerCase())) {
          return pathSeries;
        }
        if (String(fileTitle).trim().split(' ').length <= 3
          && String(pathSeries).split(' ').length > String(fileTitle).split(' ').length
          && !String(fileTitle).trim().toLowerCase().includes(String(pathSeries).toLowerCase())) {
          return pathSeries;
        }
      }
    }
    const title = parsed.title || parsed.movie;
    if (typeof title === 'string' && String(title).trim()) {
      if (parsed.type === 'episode'
        && String(title).trim().split(' ').length <= 4
        && !/\b\d+_\d+\b/.test(pathSeries)) {
        if (isFullerTitle(pathSeries, title) || !String(title).trim().toLowerCase().includes(String(pathSeries).toLowerCase())) {
          return pathSeries;
        }
      }
    }
  }
  const series = parsed.series;
  if (typeof series === 'string' && String(series).trim()) {
    if ((parsed.type === 'episode' || parsed.episode != null) && isFullerTitle(pathSeries, series)) return pathSeries;
    return String(series).trim();
  }
  const title = parsed.title || parsed.movie;
  if (typeof title === 'string' && String(title).trim()) {
    if (parsed.type === 'episode' || (parsed.season != null && parsed.episode != null)) {
      if (isFullerTitle(pathSeries, title) || (pathSeries && !_hasAlpha(title))) return pathSeries;
      if (pathSeries && c.container_path
        && String(title).trim().split(' ').length <= 3
        && !/\b\d+_\d+\b/.test(pathSeries)
        && !String(title).trim().toLowerCase().includes(String(pathSeries).toLowerCase())) {
        return pathSeries;
      }
    }
    return String(title).trim();
  }
  if (c.container_path) {
    const folderName = String(c.container_path).split('/').pop();
    if (folderName) return folderName.trim();
  }
  const stem = stemOf(c.name);
  return stem.trim() || null;
}

export function extractEpisodeTitle(parsed, candidate) {
  const c = candidate || {};
  const epTitle = parsed.episode_title;
  if (typeof epTitle === 'string' && epTitle.trim()) {
    const t = epTitle.trim();
    // Filler labels and echoes of the parsed title/series are never real
    // episode titles (internally they usually mean the name carries only
    // markers + a generic label like "Episode 1" or a bare episode id).
    if (!isFillerEpisodeTitle(t) && normalizeTitleKey(t) !== normalizeTitleKey(parsed.title || parsed.movie || '')) return t;
    return null;
  }
  const name = c.name;
  let cleaned = stemOf(name);
  cleaned = cleaned.replace(CRC_BRACKETS_RE, '');
  cleaned = cleaned.replace(CRC_PAREN_RE, '');
  const bareTitle = extractContainedBareEpisodeTitle(cleaned);
  if (bareTitle && !containerIsMovieFolder(c) && parsed.year == null) return bareTitle;
  const m = cleaned.match(FILENAME_EP_TITLE_RE);
  if (m) return m[1].trim();
  return null;
}

export function containerDeclaresExtras(containerName) {
  return BUNDLE_EXTRA_SIGNALS_RE.test(String(containerName || ''));
}

export function extractBundleShowTitle(rawName) {
  let cleaned = String(rawName || '').replace(LEADING_BRACKET_RE, '');
  while (TRAILING_BRACKET_RE.test(cleaned)) cleaned = cleaned.replace(TRAILING_BRACKET_RE, '');
  if (!cleaned) return null;
  const tokens = String(cleaned).split(/[\s_&+]+/).filter((t) => t.length > 0);
  const parts = [];
  for (let token of tokens) {
    const low = token.toLowerCase();
    if (BUNDLE_EP_RANGE_RE.test(low)) break;
    if (low.replace(/[^a-z]/g, '') in BUNDLE_DECL_WORDS || BUNDLE_DECL_WORDS.has(low.replace(/[^a-z]/g, ''))) break;
    parts.push(token.replace(/^[-._ ]+|[-._ ]+$/g, ''));
  }
  const title = parts.join(' ').replace(/^[-._ ]+|[-._ ]+$/g, '');
  if (!title || !/[a-z]/i.test(title)) return null;
  return title;
}

export function bundleShowTitleFromContainer(candidate) {
  const c = candidate || {};
  if (!c.container_path) return null;
  const name = String(c.container_path).split('/').pop() || '';
  if (!containerDeclaresExtras(name)) return null;
  return extractBundleShowTitle(name);
}