export const HISTORY_DEFAULTS = Object.freeze({ enabled: true, intervalMinutes: 2, maxEntries: 50, retentionDays: 30 });
export function historyOptions(value = HISTORY_DEFAULTS) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw Error("历史设置无效。");
  const result = { ...HISTORY_DEFAULTS, ...value };
  if (Object.keys(value).some(key => !Object.hasOwn(HISTORY_DEFAULTS, key)) || typeof result.enabled !== "boolean") {
    throw Error("历史设置无效。");
  }
  for (const [key, min, max] of [["intervalMinutes", 1, 60], ["maxEntries", 5, 100], ["retentionDays", 1, 365]]) {
    if (!Number.isInteger(result[key]) || result[key] < min || result[key] > max) {
      throw Error("历史记录的间隔、版本数或天数超出范围。");
    }
  }
  return result;
}
export function storedHistoryOptions(text) {
  try {
    return historyOptions(text ? JSON.parse(text) : undefined);
  } catch {
    return { ...HISTORY_DEFAULTS };
  }
}
