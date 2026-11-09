// Merged regex set (both projects) + sane caps/guards.
// Single source of truth for every S/E rule: if a regex exists anywhere
// else, that is a bug — it belongs here.
//
// Ported from jellysort app/classification/patterns.py (which itself absorbed
// the JellyJake-ported robustness patterns) plus the shared look-around
// x-notation forms from jellyjake queryBuilder.js. Classify-only cascade
// regexes (movie signals, part packs) live in categorize.js; title-scrubbing
// regexes used only by titles.js live here too so scrubbing stays in one place.

export const SEASON_MAX = 60;
export const EPISODE_MAX = 500;
// Codec numbers are never episode numbers in x-notation.
export const CODEC_EPISODES = new Set([264, 265]);

// Zero-width "word" boundaries that ALSO split on "_" (regex \b treats "_"
// as a word char, so /\bNCED\b/ misses "NCED_DVD" and /\bsample\b/ misses
// "file_sample" — the standard fansub underscore-joined shape).
export const MARKER_LB = '(?<![a-z0-9])';
export const MARKER_LA = '(?![a-z0-9])';

export const EXTRA_MARKERS = new RegExp(
  MARKER_LB + '(ncop\\d*(?:v\\d+)?|nced\\d*(?:v\\d+)?|op\\d*(?:v\\d+)?|ed\\d*(?:v\\d+)?|sp\\d*(?:v\\d+)?|ova|ona|special|extras?|featurettes?|bonus|recap|trailer)' + MARKER_LA, 'i',
);
export const SAMPLE_MARKERS = new RegExp(MARKER_LB + 'sample' + MARKER_LA, 'i');
export const SEASON_EPISODE_RE = /s\d{1,2}e\d{1,3}/i;
export const SPECIAL_TAG_RE = /(?:^|[\s[\]()_.-])sp(?:[\s[\]()_.-]|$)/i;
export const DECIMAL_EPISODE_RE = /(?:^|[^a-z0-9])s\d{1,2}e\d{1,3}\.\d+(?:[^a-z0-9]|$)/i;
export const SEASON_ONLY_RE = /season\s*\d{1,2}|s\d{1,2}\b/i;
export const SEASON_EPISODE_TOKEN_RE = new RegExp(
  '(?:^|[^a-z0-9])s(?<season>\\d{1,2})e(?<episode>\\d{1,3})(?:v\\d+)?(?:[^a-z0-9]|$)', 'i',
);
export const SEASON_DASH_EPISODE_RE = new RegExp(
  '(?:^|[^a-z0-9])s(?<season>\\d{1,2})\\s*-\\s*(?<episode>\\d{1,3})(?:v\\d+)?(?:[^a-z0-9]|$)', 'i',
);
export const SEASON_WORD_DASH_EPISODE_RE = new RegExp(
  '(?:^|[^a-z0-9])season\\s*(?<season>\\d{1,2})\\s*-\\s*(?<episode>\\d{1,3})(?:v\\d+)?(?:[^a-z0-9]|$)', 'i',
);
export const SEASON_FOLDER_RE = new RegExp('(?:^|[^a-z0-9])(?:season\\s*|s)(?<season>\\d{1,2})(?:[^a-z0-9]|$)', 'i');
export const BARE_EPISODE_RE = new RegExp('(?:^|[^a-z0-9])(?<episode>\\d{1,3})(?:v\\d+)?(?:[^a-z0-9]|$)', 'i');
export const CONTAINED_BARE_EPISODE_RE = new RegExp(
  '^(?<episode>\\d{1,3})(?:v\\d+)?\\s*(?:[-_ ]|\\.(?!\\d))\\s*(?<title>\\S.*)$', 'i',
);
export const MOVIE_MARKER_RE = /\bmovie[\s_.-]*\d{1,3}\b/i;
export const FRANCHISE_MOVIE_MARKER_RE = /\bs\d{1,2}m\d{1,2}\b/i;

export const FOREIGN_EPISODE_RE = new RegExp(
  '(?:^|[^a-z0-9])(?:series|episodio|episode|capitulo|capitolo|capítulo|chapitre|épisode|kapitel)\\s*(\\d{1,3})(?:v\\d+)?(?:[^a-z0-9]|$)', 'i',
);

export const SEASON_MARKER_RE = /\s+(?:S\d{1,2}(?:[-–_]\s*S?\d{1,2})?(?:\+?P\d{1,2})?(?:\+SP)?|\(?Season\s*\d{1,2}(?:\s*[-–]\s*\d{1,2})?\)?)(?=\s|[-,._]|$)/i;
export const SEASON_PLUS_TEXT_RE = /\s+S\d{1,2}\+.*$/i;
export const TECH_TAG_RE = /\s+\[?(?:\d{3,4}p|(?:Dual\s+)?Audio|BDRip|BluRay|WEB[.-]?DL|WebRip|HDRip|x264|x265|HEVC|10\s*bit)/i;
export const TRAILING_GROUP_RE = /\s*[-–]\s*[A-Za-z0-9]+$/;
export const TRAILING_BRACKET_RE = /\s*\[.*?\]\s*$/;
export const TRAILING_PAREN_TECH_RE = /\s*\([^)]*\b(?:\d{3,4}p|x264|x265|HEVC|BDRip|BluRay|WEB[.-]?DL|WEBRip|HDRip|Dual\s*Audio|10\s*bit)\b[^)]*\)\s*$/i;
export const LEADING_BRACKET_RE = /^(?:\[[^\]]+\]\s*)+/;

export const CRC_BRACKETS_RE = /\s*\[[A-Fa-f0-9]{6,10}\]\s*$/;
export const CRC_PAREN_RE = /\s*\([A-Fa-f0-9]{6,10}\)\s*$/;
export const FILENAME_EP_TITLE_RE = /^S\d{1,2}E\d{1,3}[-. ]+(.+)/i;

// Word-form S+E without dash: "Season 1 Episode 5", "Season 2 Ep 03".
export const SEASON_WORD_EPISODE_RE = new RegExp(
  '(?:^|[^a-z0-9])season\\s*(?<season>\\d{1,2})\\s*(?:episode|episodes|eps?|ep)\\s*(?<episode>\\d{1,3})(?:v\\d+)?(?:[^a-z0-9]|$)', 'i',
);

// Episode-only markers: "E05", "Episode 5", "Ep 12" (season carried separately).
export const EP_ONLY_S_RE = new RegExp('(?:^|[^a-z0-9])e(?<episode>\\d{1,3})(?:v\\d+)?(?:[^a-z0-9]|$)', 'i');
export const EP_ONLY_WORD_RE = new RegExp(
  '(?:^|[^a-z0-9])(?:episode|episodes|eps?|ep)\\s*(?<episode>\\d{1,3})(?:v\\d+)?(?:[^a-z0-9]|$)', 'i',
);

// x-notation: "1x05". Guarded in code (season ≤ 60, ep not 264/265,
// no digit/dot directly before, never dimensions like 1920x1080).
export const X_NOTATION_RE = new RegExp(
  '(?<![\\d.])(?<!\\d )(?:^|[^a-z0-9])(?<season>\\d{1,2})\\s*x\\s*(?<episode>\\d{1,3})(?:[^a-z0-9]|$)', 'i',
);

// Anime fansub finale: "S2 - 12 END" / "Season 2 - 12 END" is S02E12.
export const END_EPISODE_S_RE = new RegExp(
  '(?:^|[^a-z0-9])s(?<season>\\d{1,2})\\s*[-–]\\s*(?<episode>\\d{1,3})\\s*END(?:[^a-z0-9]|$)', 'i',
);
export const END_EPISODE_WORD_RE = new RegExp(
  '(?:^|[^a-z0-9])season\\s*(?<season>\\d{1,2})\\s*[-–]\\s*(?<episode>\\d{1,3})\\s*END(?:[^a-z0-9]|$)', 'i',
);

// Anime "Part"-episode: "Part 2 - 06" with a season anchor elsewhere.
export const PART_EP_RE = /\bpart\s*\d+\s*[-–]\s*0*(?<episode>\d{1,3})(?![\w])/i;

// 4-digit year or resolution standing where an episode number would go.
export const YEAR_OR_RES_RE = /\b(?:19\d{2}|20\d{2}|480p?|576p?|720p?|1080p?|2160p?)\b/i;

// Year token anywhere (first match wins, guessit single_value semantics).
export const YEAR_TOKEN_RE = /\b(19\d{2}|20\d{2})\b/;

// Bundle containers that declare extra content: "Show Ep1-12 + Extras & OST".
export const BUNDLE_EXTRA_SIGNALS_RE = /(?:^|[^a-z0-9])(?:extras?|ova|ona|specials?|bonus|ost|soundtrack)(?:[^a-z0-9]|$)/i;
export const BUNDLE_EP_RANGE_RE = /^ep?\d+(?:\s*[–—\-]?\s*\d+)?$/i;
export const BUNDLE_DECL_WORDS = new Set([
  'extras', 'extra', 'ova', 'ona', 'specials', 'special', 'bonus', 'ost', 'soundtrack',
]);
