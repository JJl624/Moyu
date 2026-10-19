import { ChevronRight, File, Folder, Package, Boxes } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import type { RuntimeFileEntry, RuntimeTreeNode } from './runtimeTree';
import './runtimeTree.css';

export function RuntimeFileTree<T extends RuntimeFileEntry>({ nodes, actions, status, downloads = true }: {
  nodes: RuntimeTreeNode<T>[];
  actions?(entry: T): ReactNode;
  status?(entry: T): ReactNode;
  downloads?: boolean;
}) {
  return <ul className="runtime-file-tree">{nodes.map(node =>
    <RuntimeBranch key={node.key} node={node} actions={actions} status={status} downloads={downloads} />
  )}</ul>;
}
function RuntimeBranch<T extends RuntimeFileEntry>({ node, actions, status, downloads }: {
  node: RuntimeTreeNode<T>;
  actions?(entry: T): ReactNode;
  status?(entry: T): ReactNode;
  downloads: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const file = node.entry, children = !!node.children.length;
  const Icon = node.kind === 'package' ? Package : node.kind === 'dependencies' ? Boxes : node.kind === 'folder' ? Folder : File;
  const label = <><ChevronRight size={12} className={'runtime-tree-chevron' + (expanded ? ' expanded' : '') + (!children ? ' empty' : '')} />
    <Icon size={14} /><span>{node.name}{node.detail && node.detail !== node.name && <small>{node.detail}</small>}</span></>;
  return <li>
    <div className="runtime-tree-row" data-runtime-file={file?.id || file?.name}>
      {children ? <button className="runtime-tree-name" aria-label={node.name} aria-expanded={expanded} title={file?.purpose}
        onClick={() => setExpanded(value => !value)}>{label}</button>
        : <span className="runtime-tree-name" title={file?.purpose}>{label}</span>}
      {file?.version && <small className="runtime-tree-meta">{file.version}</small>}
      {node.kind === 'package' && <small className="runtime-tree-meta">npm 包</small>}
      {file?.bytes !== undefined && <small className="runtime-tree-meta">{file.bytes < 1048576
        ? Math.ceil(file.bytes / 1024) + ' KB' : (file.bytes / 1048576).toFixed(2) + ' MB'}</small>}
      {file && status?.(file)}
      {file && <div className="runtime-tree-actions">
        {downloads && file.url && <a href={file.url} target="_blank" rel="noreferrer" title={file.url}>{node.kind === 'package' ? '下载包' : '下载文件'}</a>}
        {downloads && file.projectURL && <a href={file.projectURL} target="_blank" rel="noreferrer">项目主页</a>}
        {downloads && file.sourcePage && <a href={file.sourcePage} target="_blank" rel="noreferrer">包版本</a>}
        {file.builtin && <small>内置</small>}
        {actions?.(file)}
      </div>}
    </div>
    {children && expanded && <RuntimeFileTree nodes={node.children} actions={actions} status={status} downloads={downloads} />}
  </li>;
}
