// Kind vocabularies + extra_type mapping (shared vocab).
// Two vocabularies, one core — do not collapse them:
//   - categorization (torrent decisions): collection | season_batch | episode |
//     episode_collection | movie | others
//   - file classification (library routing): series | movie | extra | skip
// `skip` is caller-assigned (low confidence, in-progress, non-media) — the
// classifier itself only ever emits series | movie | extra.
// Ported from jellysort app/classification/kinds.py.

import {
  DECIMAL_EPISODE_RE,
  EXTRA_MARKERS,
  MARKER_LA,
  MARKER_LB,
  SAMPLE_MARKERS as SAMPLE_MARKERS_RE,
  SEASON_EPISODE_RE,
  SPECIAL_TAG_RE,
} from './patterns.js';

export const CATEGORIZE_KINDS = Object.freeze([
  'collection', 'season_batch', 'episode', 'episode_collection', 'movie', 'others',
]);

export const FILE_TYPES = Object.freeze(['series', 'movie', 'extra', 'skip']);

export const CLASSIFIER_TYPES = Object.freeze(['series', 'movie', 'extra']);

// Words that are an extra all by themselves (generic extra titles).
export const GENERIC_EXTRA_SET = new Set([
  'ed', 'op', 'nc', 'nced', 'ncop', 'ova', 'ona', 'sp', 'special', 'extras', 'extra',
  'featurette', 'featurettes', 'bonus', 'recap', 'trailer', 'short', 'interview', 'deleted',
  'behindthescenes',
]);

// Files under this size (bytes) with no `sample` marker stay an editable
// movie — the orchestrator flags them sample-suspect instead of routing.
export const SAMPLE_SIZE_THRESHOLD = 150 * 1024 * 1024;

// Kind/confidence ladder for classifyFile (pinned by tests/classifyFile.test.js).
export const CONFIDENCE = Object.freeze({
  explicitEpisode: 0.9,
  seasonOnly: 0.8,
  yearMovie: 0.75,
  defaultMovie: 0.65,
  extraFloor: 0.85,
});

export const REASON = Object.freeze({
  explicitEpisode: 'Matched episode/season pattern',
  seasonOnly: 'Matched season pattern',
  guessedMovie: 'Matched movie pattern',
  yearMovie: 'Matched year without season/episode',
  defaultMovie: 'Defaulted standalone file to movie',
  smallFileSuspect: ' (small file; sample-size suspect)',
});

export function inferKind(label, parsed, season, episode, hasExplicitEpisode) {
  const guessedType = parsed.type;
  if (hasExplicitEpisode) {
    return { kind: 'series', confidence: CONFIDENCE.explicitEpisode, reason: REASON.explicitEpisode };
  }
  if (guessedType === 'episode' && episode != null) {
    return { kind: 'series', confidence: CONFIDENCE.explicitEpisode, reason: 'Matched episode pattern' };
  }
  if (season != null) {
    return { kind: 'series', confidence: CONFIDENCE.seasonOnly, reason: REASON.seasonOnly };
  }
  if (guessedType === 'movie') {
    return { kind: 'movie', confidence: 0.9, reason: REASON.guessedMovie };
  }
  if (parsed.year && !SEASON_EPISODE_RE.test(label)) {
    return { kind: 'movie', confidence: CONFIDENCE.yearMovie, reason: REASON.yearMovie };
  }
  return { kind: 'movie', confidence: CONFIDENCE.defaultMovie, reason: REASON.defaultMovie };
}

export function looksLikeExtra(label, episodeTitle) {
  if (EXTRA_MARKERS.test(label)) return true;
  if (SPECIAL_TAG_RE.test(label)) return true;
  if (DECIMAL_EPISODE_RE.test(label)) return true;
  if (typeof episodeTitle === 'string' && EXTRA_MARKERS.test(episodeTitle)) return true;
  return false;
}

// The specific extra type for routing to extras/ — most specific first.
export function extraType(label, episodeTitle) {
  let text = label.toLowerCase();
  if (typeof episodeTitle === 'string') text += ' ' + episodeTitle.toLowerCase();
  const LB = MARKER_LB;
  const LA = MARKER_LA;
  if (new RegExp(LB + 'sample' + LA).test(text)) return 'sample';
  if (new RegExp(LB + 'trailer' + LA).test(text)) return 'trailer';
  if (new RegExp(LB + 'behindthescenes' + LA).test(text) || /behind.*scene/.test(text)) return 'behind';
  if (new RegExp(LB + 'deleted').test(text)) return 'deleted';
  if (new RegExp(LB + 'interview' + LA).test(text)) return 'interview';
  if (new RegExp(LB + 'featurette' + LA).test(text)) return 'featurette';
  if (new RegExp(LB + 'short' + LA).test(text)) return 'short';
  if (new RegExp(LB + 'sp\\d*(?:v\\d+)?' + LA).test(text) || new RegExp(LB + 'special' + LA).test(text)) return 'special';
  if (new RegExp(LB + 'extra' + LA).test(text)) return 'extra';
  if (EXTRA_MARKERS.test(label) || SPECIAL_TAG_RE.test(label) || DECIMAL_EPISODE_RE.test(label)) return 'special';
  return null;
}

export function sampleMarkerHit(label, title, other) {
  if (SAMPLE_MARKERS_RE.test(label)) return true;
  if (typeof title === 'string' && SAMPLE_MARKERS_RE.test(title)) return true;
  if (typeof other === 'string' && SAMPLE_MARKERS_RE.test(other)) return true;
  return false;
}

export function looksLikeSample(label, title, other, fileSize) {
  if (sampleMarkerHit(label, title, other)) return true;
  if (fileSize != null && fileSize < SAMPLE_SIZE_THRESHOLD) return true;
  return false;
}
