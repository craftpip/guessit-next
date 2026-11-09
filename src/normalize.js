// Name cleaning: separator normalization + lowercase.
// Ported from jellyjake normalizeParseName (queryBuilder.js).
// Torrent naming is messy ("Show.Season.2.720p" vs "Show_Season_2_720p" vs
// "Show Season 2 720p") — normalize separators before any marker extraction
// so pattern matching sees "season 2" regardless of separator.
// NOTE: hyphens/em-dashes are preserved — multi-season ranges ("S01-S08")
// and episode ranges ("S01E01-E13") depend on them.

export function normalizeParseName(name) {
  return (name || '')
    .toLowerCase()
    .replace(/[_]+/g, ' ')
    .replace(/[.]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
