const { atomicIfChanged } = require('./files.cjs');
const { SyncState } = require('./sync-state.cjs');
// Separate metadata snapshot: opening/expanding the cloud tree performs no requests.
async function readTree(file) {
  const content = await new SyncState(file).readFile(file + '.tree.json');
  if (!content) return null;
  const value = JSON.parse(content);
  if (!Array.isArray(value.entries) || value.entries.length > 20000) return null;
  // Earlier snapshots mixed server times with local upload completion times.
  // Keep the cached structure but show dates only after a fresh metadata scan.
  if (value.version !== 2) value.entries = value.entries.map(({modified,created,...entry})=>entry);
  const scanned = await new SyncState(file).readFile(file + '.tree-scan.json');
  if (scanned) value.scannedAt = JSON.parse(scanned).scannedAt;
  return value;
}
async function saveTree(file, root, entries) {
  entries = [...entries].sort((a,b)=>a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  const value = { version:2, root, scannedAt: Date.now(), entries };
  // Stable listings are not rewritten merely to update the scan timestamp.
  await atomicIfChanged(file + '.tree.json', JSON.stringify({version:2,root,entries}));
  await atomicIfChanged(file + '.tree-scan.json', JSON.stringify({scannedAt:value.scannedAt}));
  return value;
}
module.exports = { readTree, saveTree };
