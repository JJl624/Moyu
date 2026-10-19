import { Cloud, CloudUpload, RefreshCw, TriangleAlert } from 'lucide-react';
export const syncLabels: Record<string, string> = {
  unconfigured: '未配置 WebDAV',
  synced: '已同步',
  pending: '待同步',
  local: '未同步',
  conflict: '同步冲突',
  syncing: '正在同步',
  error: '同步失败',
  excluded: '不参与同步',
};
export function SyncBadge(
  { name, state, system }: { name: string; state?: string; system?: boolean },
) {
  const status = system ? 'excluded' : state || 'unconfigured';
  return (
    <span
      className={'sync-badge ' + status}
      title={system ? '应用数据，不参与同步' : 'WebDAV：' + syncLabels[status]}
      aria-label={name + '，WebDAV：' + syncLabels[status]}
    >
      {status === 'pending' || status === 'local'
        ? <CloudUpload size={13} />
        : status === 'conflict' || status === 'error'
        ? <TriangleAlert size={13} />
        : status === 'syncing'
        ? <RefreshCw size={13} className='spin' />
        : status === 'synced'
        ? <Cloud size={13} />
        : null}
    </span>
  );
}
