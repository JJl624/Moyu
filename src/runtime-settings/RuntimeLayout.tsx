import { isComposingKey } from '../keyboardComposition';
import { FolderOpen, RotateCw } from 'lucide-react';
import { createContext, type ReactNode, useContext, useEffect, useId, useRef, useState } from 'react';
import '../runtimePreferences.css';

export type RuntimeNotice = { text: string; error?: boolean; } | null;
type Panel = { id: string; label: string; content: ReactNode; };
const RuntimePanelActive = createContext(true);
export const useRuntimePanelActive = () => useContext(RuntimePanelActive);

export function RuntimeLayout(
  { title, summary, ready, panels, beforeChange, restart, busy, notice, progress }: {
    title: string;
    summary: string;
    ready: boolean;
    panels: Panel[];
    beforeChange(): Promise<void>;
    restart(): void;
    busy: boolean;
    notice: RuntimeNotice;
    progress?: ReactNode;
  },
) {
  const [active, setActive] = useState('settings');
  const [visited, setVisited] = useState(() => new Set(['settings']));
  const panelId = useId();
  const [changing, setChanging] = useState(false);
  const navigation = useRef<HTMLDivElement>(null);
  const focusTarget = useRef('');
  useEffect(() => {
    if (!changing && focusTarget.current) {
      navigation.current?.querySelector<HTMLButtonElement>(`[data-panel="${focusTarget.current}"]`)?.focus();
      navigation.current?.closest('.pref-content')?.scrollTo({ top: 0 });
      focusTarget.current = '';
    }
  }, [active, changing]);
  const select = async (id: string) => {
    if (changing || id === active) return;
    setChanging(true);
    try {
      await beforeChange();
      setVisited(previous => new Set([...previous, id]));
      focusTarget.current = id;
      setActive(id);
    } catch {
      /* The owning draft displays the validation error. */
    } finally {
      setChanging(false);
    }
  };
  return (
    <div className='runtime-workspace'>
      <div className='runtime-page-heading'>
        <div>
          <h3>{title}</h3>
          <p className='runtime-version'>{summary || '正在读取…'}</p>
        </div>
        <div className='runtime-page-actions'>
          <span className={'runtime-state ' + (ready ? 'ready' : '')}>{ready ? '就绪' : '未安装'}</span>
          <button
            className='secondary-button'
            aria-label='重启运行环境'
            title='重启运行环境'
            disabled={busy}
            onClick={restart}
          >
            <RotateCw size={14} />重启
          </button>
        </div>
      </div>
      <div
        className='runtime-tabs'
        role='tablist'
        aria-label={title + ' 设置分区'}
        ref={navigation}
        onKeyDown={event => {
          const index = panels.findIndex(panel => panel.id === active);
          const next = event.key === 'ArrowRight'
            ? (index + 1) % panels.length
            : event.key === 'ArrowLeft'
            ? (index + panels.length - 1) % panels.length
            : event.key === 'Home'
            ? 0
            : event.key === 'End'
            ? panels.length - 1
            : -1;
          if (next >= 0) {
            event.preventDefault();
            void select(panels[next].id);
          }
        }}
      >
        {panels.map(panel => (
          <button
            key={panel.id}
            role='tab'
            data-panel={panel.id}
            aria-selected={active === panel.id}
            id={panelId + '-tab-' + panel.id}
            aria-controls={panelId + '-' + panel.id}
            tabIndex={active === panel.id ? 0 : -1}
            disabled={changing}
            onClick={() => void select(panel.id)}
          >
            {panel.label}
          </button>
        ))}
      </div>
      {notice && (
        <p
          className={'runtime-notice ' + (notice.error ? 'feature-error' : '')}
          role={notice.error ? 'alert' : 'status'}
        >
          {notice.text}
        </p>
      )}
      {progress}
      {!ready && active === 'settings' && (
        <div className='runtime-setup'>
          <span>未安装环境</span>
          <button className='secondary-button' onClick={() => void select('environment')}>
            安装运行环境
          </button>
        </div>
      )}
      {panels.map(panel => (
        <div
          key={panel.id}
          id={panelId + '-' + panel.id}
          role='tabpanel'
          aria-labelledby={panelId + '-tab-' + panel.id}
          className='runtime-panel'
          hidden={active !== panel.id}
        >
          <RuntimePanelActive.Provider value={active === panel.id}>
            {visited.has(panel.id) ? panel.content : null}
          </RuntimePanelActive.Provider>
        </div>
      ))}
    </div>
  );
}

export function RuntimeVersions({ versions, selected, busy, use, remove, reveal }: {
  versions: { version: string; label?: string; detail?: string; }[];
  selected: string;
  busy: boolean;
  use(version: string): void;
  remove(version: string): Promise<void>;
  reveal?(version: string): void;
}) {
  const [confirm, setConfirm] = useState('');
  return (
    <div
      className='runtime-version-list'
      aria-label='已安装运行环境'
      onKeyDown={event => {
        if (event.key === 'Escape' && !isComposingKey(event) && confirm) {
          event.stopPropagation();
          setConfirm('');
        }
      }}
    >
      {!versions.length && <p className='runtime-empty'>尚未安装</p>}
      {versions.map(version => (
        <div className='runtime-installed' key={version.version}>
          <div className='runtime-version-label'>
            <strong>{version.label || version.version}</strong>
            {version.detail && <small>{version.detail}</small>}
          </div>
          <div className='runtime-version-actions'>
            {reveal && (
              <button
                className='icon-button'
                disabled={busy}
                aria-label={'打开环境目录 ' + version.version}
                title='打开环境目录'
                onClick={() => reveal(version.version)}
              >
                <FolderOpen size={14} />
              </button>
            )}
            {selected === version.version
              ? <span className='runtime-current'>当前</span>
              : (
                <button className='secondary-button' disabled={busy} onClick={() => use(version.version)}>
                  使用
                </button>
              )}
            {confirm === version.version
              ? (
                <>
                  <button
                    className='runtime-danger'
                    disabled={busy}
                    onClick={() => void remove(version.version).then(() => setConfirm('')).catch(() => {})}
                  >
                    确认删除
                  </button>
                  <button disabled={busy} onClick={() => setConfirm('')}>取消</button>
                </>
              )
              : <button disabled={busy} onClick={() => setConfirm(version.version)}>删除</button>}
          </div>
        </div>
      ))}
    </div>
  );
}

export function RuntimeSection(
  { title, children, actions }: { title: string; children: ReactNode; actions?: ReactNode; },
) {
  return (
    <section className='pref-section'>
      <div className='pref-section-heading'>
        <h4>{title}</h4>
        {actions && <div>{actions}</div>}
      </div>
      {children}
    </section>
  );
}
