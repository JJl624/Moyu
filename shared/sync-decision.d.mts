export function syncDecision(localHash: string | null, remoteVersion: string | null, baseline?: {localHash:string;remoteEtag:string}): 'unchanged'|'conflict'|'download'|'upload'|'compare';
