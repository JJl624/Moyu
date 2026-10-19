import { useEffect, useRef, useState } from 'react';
import { type ITheme, Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import {
  ChevronDown,
  ClipboardPaste,
  Columns2,
  Copy,
  Minus,
  Plus,
  Rows2,
  TerminalSquare,
  X,
} from 'lucide-react';
import { api } from '../bridge';
import { type TerminalSettings, terminalSettings } from './terminalSettings';
import type { TerminalProfile } from './terminalProfiles';
import '@xterm/xterm/css/xterm.css';
import './terminal.css';
type Session = { id: string; pid: number; title: string; cwd: string; exited?: boolean; exitCode?: number };
type TerminalEvent = { type: 'data' | 'exit'; id: string; data?: string; offset?: number; exitCode?: number };
function terminalTheme(element: HTMLElement): ITheme {
  const style = getComputedStyle(element),
    color = (key: string, fallback: string) => style.getPropertyValue(key).trim() || fallback,
    bg = color('--bg', '#1d1f24'),
    fg = color('--text', '#d5d7de');
  return {
    background: bg,
    foreground: fg,
    cursor: color('--accent', '#abb8fa'),
    cursorAccent: bg,
    selectionBackground: color('--selection', '#6475b844'),
    black: bg,
    brightBlack: color('--secondary', '#969ba9'),
    red: color('--red', '#df6e6e'),
    brightRed: color('--red', '#df6e6e'),
    green: color('--green', '#8bae7c'),
    brightGreen: color('--green', '#8bae7c'),
    yellow: color('--yellow', '#c7ab6b'),
    brightYellow: color('--yellow', '#c7ab6b'),
    blue: color('--accent', '#abb8fa'),
    brightBlue: color('--accent', '#abb8fa'),
    magenta: color('--purple', '#b48ead'),
    brightMagenta: color('--purple', '#b48ead'),
    cyan: color('--cyan', '#7db3c7'),
    brightCyan: color('--cyan', '#7db3c7'),
    white: fg,
    brightWhite: fg,
  };
}
function TerminalView(
  { session, visible, themeKey, config, exited }: {
    session: Session;
    visible: boolean;
    themeKey: string;
    config: TerminalSettings;
    exited(id: string, code: number): void;
  },
) {
  const container = useRef<HTMLDivElement>(null),
    terminal = useRef<XTerm | null>(null),
    fit = useRef<FitAddon | null>(null),
    isVisible = useRef(visible),
    apply = useRef(() => {}),
    [error, setError] = useState('');
  isVisible.current = visible;
  useEffect(() => {
    const node = container.current!;
    let alive = true, loaded = false, position = 0;
    const pending: TerminalEvent[] = [],
      t = new XTerm({
        allowProposedApi: false,
        scrollback: config.scrollback,
        fontSize: config.fontSize,
        lineHeight: config.lineHeight,
        cursorStyle: config.cursorStyle,
        cursorBlink: config.cursorBlink,
        theme: terminalTheme(node),
        fontFamily: config.family || getComputedStyle(node).getPropertyValue('--font-mono').trim() || 'monospace',
      }),
      addon = new FitAddon();
    terminal.current = t;
    fit.current = addon;
    t.loadAddon(addon);
    t.open(node);
    t.attachCustomKeyEventHandler(event => {
      if (
        event.type === 'keydown' && (event.ctrlKey || event.metaKey) && event.shiftKey
        && event.key.toLowerCase() === 'c'
      ) {
        event.preventDefault();
        event.stopPropagation();
        copy();
        return false;
      }
      if (
        event.type === 'keydown' && (event.ctrlKey || event.metaKey) && event.shiftKey
        && event.key.toLowerCase() === 'v'
      ) {
        event.preventDefault();
        event.stopPropagation();
        paste();
        return false;
      }
      return true;
    });
    const ack = (offset: number) => {
      if (alive) void api.feature('terminal.ack', { id: session.id, offset }).catch(() => {});
    };
    const receive = (event: TerminalEvent) => {
      if (event.id !== session.id) return;
      if (!loaded) {
        pending.push(event);
        return;
      }
      if (event.type === 'exit') {
        t.options.disableStdin = true;
        exited(session.id, event.exitCode || 0);
        return;
      }
      const end = event.offset || 0,
        start = end - (event.data?.length || 0),
        text = (event.data || '').slice(Math.max(0, position - start));
      if (end > position) {
        position = end;
        t.write(text, () => ack(end));
      } else ack(end);
    };
    const unsubscribe = api.onTerminal?.(receive),
      input = t.onData(data =>
        void api.feature('terminal.write', { id: session.id, data }).catch(e => {
          if (alive) setError(e.message);
        })
      );
    void api.feature<Session & { output: string; offset: number }>('terminal.snapshot', { id: session.id }).then(
      snapshot => {
        if (!alive) return;
        position = snapshot.offset;
        t.write(snapshot.output, () => ack(snapshot.offset));
        if (snapshot.exited) {
          t.options.disableStdin = true;
          exited(session.id, snapshot.exitCode || 0);
        }
        loaded = true;
        for (const event of pending) receive(event);
        pending.length = 0;
      },
    ).catch(e => {
      if (alive) setError(e.message);
    });
    let timer: ReturnType<typeof setTimeout> | undefined, last = '';
    apply.current = () => {
      if (!isVisible.current || !node.clientWidth || !node.clientHeight) return;
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (!alive || !isVisible.current) return;
        try {
          addon.fit();
          if (t.cols > 500 || t.rows > 500) t.resize(Math.min(500, t.cols), Math.min(500, t.rows));
          const size = t.cols + ':' + t.rows;
          if (size !== last) {
            last = size;
            void api.feature('terminal.resize', { id: session.id, cols: t.cols, rows: t.rows }).catch(() => {});
          }
        } catch { /* The view may have been hidden during measurement. */ }
      }, 30);
    };
    const observer = new ResizeObserver(() => apply.current());
    observer.observe(node);
    apply.current();
    return () => {
      alive = false;
      clearTimeout(timer);
      observer.disconnect();
      unsubscribe?.();
      input.dispose();
      t.dispose();
      terminal.current = null;
      fit.current = null;
    };
  }, [session.id]);
  useEffect(() => {
    const t = terminal.current, node = container.current;
    if (!t || !node) return;
    t.options.theme = terminalTheme(node);
    t.options.fontFamily = config.family || getComputedStyle(node).getPropertyValue('--font-mono').trim()
      || 'monospace';
    t.options.fontSize = config.fontSize;
    t.options.lineHeight = config.lineHeight;
    t.options.cursorStyle = config.cursorStyle;
    t.options.cursorBlink = visible && config.cursorBlink;
    t.options.scrollback = config.scrollback;
    apply.current();
    if (visible) t.focus();
    else t.blur();
  }, [themeKey, config, visible]);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [menu]);
  const copy = () => {
      const text = terminal.current?.getSelection();
      if (text) void api.feature('clipboard.write', { text });
      setMenu(null);
    },
    paste = () => {
      void api.feature<string>('clipboard.read').then(value => terminal.current?.paste(value)).catch(e =>
        setError(e.message)
      );
      setMenu(null);
    };
  return (
    <div
      className='terminal-session'
      hidden={!visible}
      onContextMenu={e => {
        e.preventDefault();
        e.stopPropagation();
        setMenu({ x: e.clientX, y: e.clientY });
      }}
    >
      <div ref={container} className='terminal-screen' aria-label={(session.id.startsWith('wasm-')?'Wasm 终端 ':'本机终端 ') + session.title} />
      {error && <p className='feature-error' role='alert'>{error}</p>}
      {menu && (
        <div
          className='terminal-menu'
          style={{ left: Math.min(menu.x, window.innerWidth - 160), top: Math.min(menu.y, window.innerHeight - 88) }}
          onPointerDown={e => e.stopPropagation()}
          role='menu'
        >
          <button role='menuitem' disabled={!terminal.current?.hasSelection()} onClick={copy}>
            <Copy size={14} />复制
          </button>
          <button role='menuitem' onClick={paste}>
            <ClipboardPaste size={14} />粘贴
          </button>
        </div>
      )}
    </div>
  );
}
export function TerminalPanel(
  { root, visible, direction, themeKey, hide, rotate, count }: {
    root: string;
    visible: boolean;
    direction: 'below' | 'right';
    themeKey: string;
    hide(): void;
    rotate(): void;
    count(value: number): void;
  },
) {
  const [sessions, setSessions] = useState<Session[]>([]),
    [active, setActive] = useState(''),
    [config, setConfig] = useState(terminalSettings),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [ready, setReady] = useState(false),
    creating = useRef(false),
    alive = useRef(true);
  const [profiles, setProfiles] = useState<TerminalProfile[]>([]),
    [shellMenu, setShellMenu] = useState<{ x: number; y: number } | null>(null),
    ended = useRef(new Set<string>()),
    latest = useRef({ sessions, active, hide });
  latest.current = { sessions, active, hide };
  const remove = (id: string) => {
    ended.current.add(id);
    while (ended.current.size > 64) ended.current.delete(ended.current.values().next().value!);
    const current = latest.current, index = current.sessions.findIndex(s => s.id === id);
    if (index < 0) return;
    const remaining = current.sessions.filter(s => s.id !== id),
      next = current.active === id ? remaining[Math.max(0, index - 1)]?.id || '' : current.active;
    latest.current = { ...current, sessions: remaining, active: next };
    setSessions(remaining);
    setActive(next);
    if (!remaining.length) current.hide();
  };
  const create = async (profile?: TerminalProfile) => {
    if (creating.current) return;
    creating.current = true;
    setShellMenu(null);
    setBusy(true);
    setError('');
    try {
      const preferences = terminalSettings(),
        session = await api.feature<Session>('terminal.open', {
          cwd: root || undefined,
          shell: profile?.shell || preferences.shell || undefined,
          args: profile?.arguments || preferences.arguments,
        });
      if (!alive.current) return;
      if (ended.current.has(session.id)) {
        if (!latest.current.sessions.length) latest.current.hide();
        return;
      }
      setSessions(v => {
        const index = v.findIndex(s => s.id === latest.current.active) + 1;
        return [...v.slice(0, index), session, ...v.slice(index)];
      });
      setActive(session.id);
    } catch (e) {
      if (alive.current) setError((e as Error).message);
    } finally {
      creating.current = false;
      if (alive.current) setBusy(false);
    }
  };
  useEffect(() => {
    if (visible && ready && !latest.current.sessions.length) void create();
  }, [visible, ready]);
  useEffect(() => {
    alive.current = true;
    let current = true;
    void api.feature<Session[]>('terminal.list').then(sessions => {
      if (current) {
        setSessions(sessions);
        setActive(sessions[0]?.id || '');
        setReady(true);
      }
    }).catch(e => {
      if (current) {
        setError(e.message);
        setReady(true);
      }
    });
    const update = () => setConfig(terminalSettings());
    window.addEventListener('moyu-terminal-settings', update);
    return () => {
      current = false;
      alive.current = false;
      window.removeEventListener('moyu-terminal-settings', update);
      void api.feature('terminal.focus', { focused: false }).catch(() => {});
    };
  }, []);
  useEffect(() => {
    count(sessions.length);
  }, [sessions.length, count]);
  useEffect(() => {
    if (!visible) {
      setShellMenu(null);
      void api.feature('terminal.focus', { focused: false }).catch(() => {});
    }
  }, [visible]);
  useEffect(() => {
    void api.feature<TerminalProfile[]>('terminal.shells').then(setProfiles).catch(() => {});
    return api.onTerminal?.(event => {
      if (event.type === 'exit') remove(event.id);
    });
  }, []);
  useEffect(() => {
    if (!shellMenu) return;
    const close = () => setShellMenu(null);
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [shellMenu]);
  const close = async (id: string) => {
    try {
      await api.feature('terminal.close', { id });
      remove(id);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <section
      className='terminal-panel'
      hidden={!visible}
      aria-label='本机终端'
      onFocusCapture={() => void api.feature('terminal.focus', { focused: true })}
      onBlurCapture={e => {
        if (!e.currentTarget.contains(e.relatedTarget)) void api.feature('terminal.focus', { focused: false });
      }}
    >
      <div className='terminal-toolbar'>
        <TerminalSquare size={15} />
        <strong>终端</strong>
        <div className='terminal-tabs' role='tablist' aria-label='终端标签页'>
          {sessions.map((session, index) => (
            <div className={'terminal-tab ' + (active === session.id ? 'active' : '')} key={session.id}>
              <button
                role='tab'
                aria-selected={active === session.id}
                title={session.cwd}
                onClick={() => setActive(session.id)}
              >
                {session.title} {index + 1}
                {session.exited ? '（已退出）' : ''}
              </button>
              <button
                className='icon-button'
                aria-label={'关闭终端 ' + (index + 1)}
                onClick={() => void close(session.id)}
              >
                <X size={12} />
              </button>
            </div>
          ))}
        </div>
        <button
          className='icon-button'
          title='新建终端'
          aria-label='新建终端'
          aria-expanded={!!shellMenu}
          disabled={busy || sessions.length >= 6}
          onClick={e => {
            const rect = e.currentTarget.getBoundingClientRect();
            setShellMenu(v => v ? null : { x: rect.right - 220, y: rect.bottom + 4 });
          }}
        >
          <Plus size={15} />
          <ChevronDown size={11} />
        </button>
        <button
          className='icon-button'
          title={direction === 'below' ? '终端移至右侧' : '终端移至下方'}
          aria-label={direction === 'below' ? '终端移至右侧' : '终端移至下方'}
          onClick={rotate}
        >
          {direction === 'below' ? <Columns2 size={15} /> : <Rows2 size={15} />}
        </button>
        <button
          className='icon-button'
          title='隐藏终端'
          aria-label='隐藏终端'
          onClick={() => {
            void api.feature('terminal.focus', { focused: false });
            hide();
          }}
        >
          <Minus size={15} />
        </button>
        <button
          className='icon-button'
          title='关闭所有终端'
          aria-label='关闭所有终端'
          disabled={!sessions.length}
          onClick={() => void api.feature('terminal.close-all').then(()=>{for(const session of [...latest.current.sessions])remove(session.id);}).catch(e=>setError(e.message))}
        >
          <X size={14} />
        </button>
      </div>
      {shellMenu && (
        <div
          className='terminal-menu terminal-shell-menu'
          role='menu'
          aria-label='新建终端 Shell'
          style={{
            left: Math.max(6, Math.min(shellMenu.x, window.innerWidth - 240)),
            top: Math.max(6, Math.min(shellMenu.y, window.innerHeight - 220)),
          }}
          onPointerDown={e => e.stopPropagation()}
        >
          <button role='menuitem' onClick={() => void create()}>默认 Shell</button>
          {profiles.map(p => (
            <button role='menuitem' key={p.id} title={p.shell} onClick={() => void create(p)}>{p.label}</button>
          ))}
        </div>
      )}
      {error && <p className='feature-error' role='alert'>{error}</p>}
      {sessions.map(session => (
        <TerminalView
          key={session.id}
          session={session}
          visible={visible && session.id === active}
          themeKey={themeKey}
          config={config}
          exited={id => remove(id)}
        />
      ))}
    </section>
  );
}
