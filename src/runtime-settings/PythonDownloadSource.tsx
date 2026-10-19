import { useEffect, useState } from 'react';

export type PythonMirror = {
  name: string;
  index: string;
  base: string;
  layout: 'cdn' | 'version';
};
export const officialPythonMirror: PythonMirror = {
  name: '官方目录 / jsDelivr',
  index: 'https://index.pyodide.org/',
  base: 'https://cdn.jsdelivr.net/pyodide/',
  layout: 'cdn',
};
const directory = (value: string) => value.trim().replace(/\/*$/, '/');
const isOfficial = (mirror: PythonMirror) => mirror.name === officialPythonMirror.name
  && directory(mirror.base) === officialPythonMirror.base
  && directory(mirror.index) === officialPythonMirror.index && mirror.layout === 'cdn';

export function PythonDownloadSource({ mirrors, selected, disabled, change }: {
  mirrors: PythonMirror[];
  selected: number;
  disabled: boolean;
  change(mirrors: PythonMirror[], selected: number, apply?: boolean): void;
}) {
  const [creating, setCreating] = useState(false);
  useEffect(() => setCreating(false), [mirrors, selected]);
  const current = mirrors[selected];
  let name = '自定义镜像', suffix = 2;
  while (mirrors.some(mirror => mirror.name === name)) name = '自定义镜像 ' + suffix++;
  const value = creating ? { ...officialPythonMirror, name } : current;
  const custom = creating || !!current && !isOfficial(current);
  const officialIndex = mirrors.findIndex(isOfficial);
  const update = (patch: Partial<PythonMirror>, apply = false) => {
    if (!value) return;
    if (creating) {
      change([...mirrors, { ...value, ...patch }], mirrors.length, apply);
      setCreating(false);
    } else change(mirrors.map((mirror, index) => index === selected ? { ...mirror, ...patch } : mirror), selected, apply);
  };
  return <div className="runtime-download-source python-download-source">
    <label className="runtime-field">
      <span>下载源</span>
      <div className="runtime-install">
        <select aria-label="Python 下载源" disabled={disabled} value={creating ? 'custom' : selected}
          onChange={event => {
            if (event.target.value === 'custom') {
              setCreating(true);
              return;
            }
            setCreating(false);
            if (event.target.value === 'official') change([...mirrors, { ...officialPythonMirror }], mirrors.length, true);
            else change(mirrors, Number(event.target.value), true);
          }}>
          {mirrors.map((mirror, index) => <option key={index} value={index}>{mirror.name || '未命名镜像'}</option>)}
          {officialIndex < 0 && <option value="official" disabled={mirrors.length >= 20}>{officialPythonMirror.name}</option>}
          <option value="custom" disabled={mirrors.length >= 20}>自定义镜像…</option>
        </select>
        {custom && !creating && mirrors.length > 1 && <button className="text-button runtime-danger"
          type="button" disabled={disabled} onClick={() => {
            const next = mirrors.filter((_, index) => index !== selected);
            change(next, Math.max(0, next.findIndex(isOfficial)), true);
          }}>移除镜像</button>}
      </div>
    </label>
    {custom && value ? <div className="python-mirror-fields">
      <label className="runtime-field">
        <span>名称</span>
        <input aria-label="Python 镜像名称" disabled={disabled} value={value.name}
          onChange={event => update({ name: event.target.value })} />
      </label>
      <label className="runtime-field">
        <span>下载地址</span>
        <input type="url" aria-label="Python 镜像地址" disabled={disabled} value={value.base}
          placeholder="https://cdn.jsdelivr.net/pyodide/" onChange={event => update({ base: event.target.value,
            layout: /jsdelivr\.net/i.test(event.target.value) ? 'cdn' : value.layout })} />
      </label>
      <label className="runtime-field">
        <span>目录结构</span>
        <select aria-label="Python 镜像目录结构" disabled={disabled} value={value.layout}
          onChange={event => update({ layout: event.target.value as PythonMirror['layout'] }, true)}>
          <option value="cdn">v{'{版本}'}/full/</option>
          <option value="version">{'{版本}'}/</option>
        </select>
      </label>
      <label className="runtime-field">
        <span>版本列表地址</span>
        <input type="url" aria-label="Python 版本列表地址" disabled={disabled} value={value.index}
          placeholder="https://index.pyodide.org/" onChange={event => update({ index: event.target.value })} />
      </label>
    </div> : current && <p className="runtime-config-path">{current.base}</p>}
  </div>;
}
