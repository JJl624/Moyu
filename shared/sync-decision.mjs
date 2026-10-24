// Pure three-way comparison. A deletion always needs a decision on mobile.
export function syncDecision(localHash, remoteVersion, baseline) {
  if (!localHash && !remoteVersion) return 'unchanged';
  if (!localHash) return baseline ? 'conflict' : 'download';
  if (!remoteVersion) return baseline ? 'conflict' : 'upload';
  if (!baseline) return 'compare';
  const localChanged = localHash !== baseline.localHash;
  const remoteChanged = remoteVersion !== baseline.remoteEtag;
  return localChanged && remoteChanged ? 'compare' : localChanged ? 'upload' : remoteChanged ? 'download' : 'unchanged';
}
