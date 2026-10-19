import { FolderOpen, LocateFixed, RefreshCw, Trash2, Upload } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { standardAttachment } from './attachmentLayout';
import {isNativeImage} from './fileKinds';
import { attachmentMarkdown } from './attachmentLinks';
import { api } from './bridge';
import { FileIcon } from './FileIcon';
import type { FileNode } from './types';
interface Item extends FileNode {
  references: string[];
  exists: boolean;
  occurrences: {from:number;to:number}[];
}
export function AttachmentsPanel({
  root,
  document,
  content,
  files,
  open,
  refresh,
  insert,
  editable,
  trash,
  locate,
}: {
  root: string;
  document: string;
  content: string;
  files: FileNode[];
  open: (path: string) => Promise<unknown>;
  refresh: () => Promise<void>;
  insert(text: string): void;
  editable: boolean;
  trash(path: string): Promise<boolean>;
  locate(path:string,offset:number):void;
}) {
  const [items, setItems] = useState<Item[]>([]),
    [query, setQuery] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [remove, setRemove] = useState<Item | null>(null);
  const alive = useRef(true);
  useEffect(() => {alive.current=true;return () => {alive.current = false;};}, []);
  const request = () => api.feature<Item[]>('attachment.list', { document, content });
  const load = async () => {
    try {
      const next = await request();
      if (alive.current) {
        setItems(next);
        setError('');
      }
    } catch (e) {
      if (alive.current) setError((e as Error).message);
    }
  };
  useEffect(() => {
    let current = true;
    const timer = setTimeout(() => {
      void request().then(next => {
        if (current) {
          setItems(next);
          setError('');
        }
      }).catch(e => {
        if (current) setError(e.message);
      });
    }, 400);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [root, document, content, files]);
  const upload = async (selected: FileList | null) => {
    if (!selected || !editable) return;
    setBusy(true);
    try {
      for (const file of Array.from(selected)) {
        const item = await api.feature<{ path: string; link: string }>('attachment.upload', {
          root,
          document,
          name: file.name,
          bytes: new Uint8Array(await file.arrayBuffer()),
        });
        if (!alive.current) return;
        const image = isNativeImage(file.name);
        insert(
          '\n\n' + (image
            ? attachmentMarkdown({ type: 'image', alt: file.name, url: item.link })
            : standardAttachment(document, item.path, file.name)) + '\n',
        );
      }
      await refresh();
    } catch (e) {
      if (alive.current) setError((e as Error).message);
    } finally {
      if (alive.current) setBusy(false);
    }
  };
  return (
    <section className='feature-panel attachment-panel' aria-label='本文件附件'>
      <div className='feature-heading'>
        <Upload size={17} />
        <strong>附件</strong>
        <button title='刷新附件' aria-label='刷新附件' onClick={() => void load()}>
          <RefreshCw size={14} />
        </button>
      </div>

      <input
        aria-label='筛选附件'
        placeholder='筛选名称或路径…'
        value={query}
        onChange={e => setQuery(e.target.value)}
      />
      <label
        className='secondary-button attachment-upload'
        title={editable ? '上传并在当前笔记插入链接' : '在预览编辑或源码模式添加附件'}
      >
        添加附件<input
          type='file'
          multiple
          disabled={busy || !editable}
          onChange={e => {
            void upload(e.target.files);
            e.target.value = '';
          }}
        />
      </label>
      {error && <p role='alert' className='feature-error'>{error}</p>}
      {[true,false].map(exists=><div key={String(exists)} className='attachment-group'>
      {items.some(i=>i.exists===exists&&i.path.toLowerCase().includes(query.toLowerCase()))&&<div className='section-label'>{exists?'附件':'不存在的附件'}</div>}
      {items.filter(i => i.exists===exists&&i.path.toLowerCase().includes(query.toLowerCase())).map(item => (
        <div className={'attachment-item'+(item.exists?'':' missing-attachment')} key={item.path}>
          <button
            className='attachment-name'
            title={item.path}
            disabled={!item.exists}
            onClick={() => void open(item.path)}
          >
            <FileIcon path={item.path} />
            <span>
              <span className='attachment-title'>{item.name}</span>
              <small>{item.path}{item.exists?' '+Math.ceil((item.size || 0) / 1024)+' KB':''}</small>
            </span>
          </button>
          <button title='定位引用' aria-label={'定位 '+item.name} disabled={!item.occurrences.length} onClick={()=>locate(item.path,item.occurrences[0].from+1)}><LocateFixed size={14}/></button>
          {item.exists&&<><button
            title='在文件夹中显示'
            aria-label={'显示 ' + item.name}
            onClick={() => void api.reveal(item.path)}
          >
            <FolderOpen size={14} />
          </button>
          <button
            title='移至回收站'
            aria-label={'删除 ' + item.name}
            onClick={() => setRemove(item)}
          >
            <Trash2 size={14} />
          </button>
          </>}
        </div>
      ))}</div>)}
      {!items.length && !error && <p className='muted-note'>暂无附件</p>}
      {remove && (
        <div className='attachment-confirm' role='alert'>
          <p>将 {remove.name} 移至回收站？本文件及其他笔记中的引用会失效。</p>
          <button className='secondary-button' onClick={() => setRemove(null)}>取消</button>
          <button
            className='danger'
            disabled={busy}
            onClick={() => {
              const item = remove;
              setBusy(true);
              void trash(item.path).then(async deleted => {
                if (deleted) {
                  setRemove(null);
                  await load();
                }
              }).catch(e => setError(e.message)).finally(() => {
                if (alive.current) setBusy(false);
              });
            }}
          >
            移至回收站
          </button>
        </div>
      )}
    </section>
  );
}
