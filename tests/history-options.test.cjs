const { test } = require("node:test"), assert = require("node:assert/strict");
const { historyOptions, storedHistoryOptions, HISTORY_DEFAULTS } = require("../shared/history-options.mjs");
test("History preferences have bounded integer limits and malformed stored settings fall back to defaults", () => {
  assert.deepEqual(historyOptions(), HISTORY_DEFAULTS);
  assert.deepEqual(historyOptions({ enabled: false }), { ...HISTORY_DEFAULTS, enabled: false });
  for (
    const value of [
      null,
      [],
      { enabled: "false" },
      { intervalMinutes: 0 },
      { intervalMinutes: 61 },
      { intervalMinutes: 1.5 },
      { maxEntries: 4 },
      { maxEntries: 101 },
      { retentionDays: 0 },
      { retentionDays: 366 },
      { extra: true },
    ]
  ) assert.throws(() => historyOptions(value));
  for (const value of [null, "bad", "null", "{\"retentionDays\":999}"]) {
    assert.deepEqual(storedHistoryOptions(value), HISTORY_DEFAULTS);
  }
  assert.deepEqual(storedHistoryOptions("{\"intervalMinutes\":5,\"maxEntries\":10,\"retentionDays\":90}"), {
    enabled: true,
    intervalMinutes: 5,
    maxEntries: 10,
    retentionDays: 90,
  });
});
