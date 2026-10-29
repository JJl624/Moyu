export const resultId = value => typeof value === 'string' && /^(?!0000)[a-f\d]{4}$/.test(value);
export function pinnedItems(record) {
  const seen = new Set();
  return (Array.isArray(record?.items) ? record.items : []).filter(item => {
    if (!item || !Number.isInteger(item.index) || item.index < 0 || item.index >= 20
      || item.file !== item.index + '.html' || typeof item.code !== 'string'
      || typeof item.language !== 'string' || seen.has(item.index)) return false;
    seen.add(item.index);return true;
  }).slice(0, 20);
}
export const resultGroups = record => record?.results && typeof record.results === 'object'
  && !Array.isArray(record.results) ? record.results : {};
