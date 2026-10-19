import { PencilLine, Plus } from 'lucide-react';
import { FileIcon } from './FileIcon';
import { displayName, type FileNode } from './types';
export { WebDAVPanel } from './WebDAVPanel';
export function DrawingsPanel({
  active,
  showExtensions,
  files,
  open,
  keep,
  create,
}: {
  active: string;
  showExtensions: boolean;
  files: FileNode[];
  open: (path: string) => void;
  keep: (path: string) => void;
  create: () => void;
}) {
  return (
    <section className='feature-panel' aria-label='绘图面板'>
      <div className='feature-heading'>
        <PencilLine size={17} />
        <strong>Excalidraw</strong>
      </div>
      <button className='primary-button feature-primary' onClick={create}>
        <Plus size={15} />
        新建绘图
      </button>
      {files
        .filter((f) =>
          f.kind === 'file' && !f.system && !f.path.split('/').includes('.data')
          && /\.excalidraw$/i.test(f.path)
        )
        .map((f) => (
          <button
            className={'drawing-file ' + (active === f.path ? 'selected' : '')}
            key={f.path}
            title={f.path}
            onClick={event => {
              if (event.detail < 2) open(f.path);
            }}
            onDoubleClick={() => keep(f.path)}
          >
            <FileIcon path={f.path} />
            {displayName(f.path, showExtensions)}
          </button>
        ))}
    </section>
  );
}
