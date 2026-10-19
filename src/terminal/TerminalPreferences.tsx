import { useEffect, useState } from 'react';
import { terminalDefaults, terminalSettings, validateTerminalSettings } from './terminalSettings';
import { usePreferenceDraft } from '../preferenceDraft';
import { settingsStore } from '../settingsStore';
import { FontSelector } from '../FontSelector';
import { enumerateFonts, type FontChoice } from '../fonts';
import { api } from '../bridge';
import { profileMatches, type TerminalProfile } from './terminalProfiles';
import { FolderOpen, RefreshCw } from 'lucide-react';
export function TerminalPreferences() {
  const [fonts, setFonts] = useState<FontChoice[]>([]);
  useEffect(() => {
    void enumerateFonts().then(setFonts).catch(() => {});
  }, []);
  const draft = usePreferenceDraft('terminal', terminalSettings(), async value => {
      validateTerminalSettings(value);
      settingsStore.setItem('moyu-terminal', JSON.stringify(value));
      await settingsStore.flush();
      window.dispatchEvent(new Event('moyu-terminal-settings'));
    }, () => structuredClone(terminalDefaults)),
    config = draft.value;
  const change = (patch: Partial<typeof config>) => draft.set(value => ({ ...value, ...patch }));
  const [profiles, setProfiles] = useState<TerminalProfile[]>([]),
    [custom, setCustom] = useState(false),
    [error, setError] = useState('');
  const detect = () =>
    void api.feature<TerminalProfile[]>('terminal.shells').then(setProfiles).catch(e => setError(e.message));
  useEffect(detect, []);
  const chosen = !config.shell && !custom
    ? 'default'
    : !custom && profiles.find(p => profileMatches(p, config.shell, config.arguments))?.id || 'custom';
  return (
    <div {...draft.events}>
      <h3>终端</h3>
      <section className='pref-section'>
        <h4>字体与样式</h4>
        <div className='pref-row'>
          <span>字体</span>
          <FontSelector
            label='终端字体'
            value={config.family}
            change={family => change({ family })}
            fonts={fonts}
            placeholder='跟随代码字体'
          />
        </div>
        <label className='pref-row'>
          <span>字号</span>
          <input
            aria-label='终端字号'
            type='number'
            min={8}
            max={36}
            value={config.fontSize}
            onChange={e => change({ fontSize: Number(e.target.value) })}
          />
        </label>
        <label className='pref-row'>
          <span>行高</span>
          <input
            aria-label='终端行高'
            type='number'
            min={1}
            max={2}
            step={.1}
            value={config.lineHeight}
            onChange={e => change({ lineHeight: Number(e.target.value) })}
          />
        </label>
        <label className='pref-row'>
          <span>光标</span>
          <select
            aria-label='终端光标样式'
            value={config.cursorStyle}
            onChange={e => {
              change({ cursorStyle: e.target.value as typeof config.cursorStyle });
              draft.apply();
            }}
          >
            <option value='block'>方块</option>
            <option value='underline'>下划线</option>
            <option value='bar'>竖线</option>
          </select>
        </label>
        <div className='pref-row'>
          <span>光标闪烁</span>
          <button
            role='switch'
            className={'toggle ' + (config.cursorBlink ? 'on' : '')}
            aria-label='终端光标闪烁'
            aria-checked={config.cursorBlink}
            onClick={() => {
              change({ cursorBlink: !config.cursorBlink });
              draft.apply();
            }}
          >
            <span />
          </button>
        </div>
        <label className='pref-row'>
          <span>回滚行数</span>
          <input
            aria-label='终端回滚行数'
            type='number'
            min={100}
            max={20000}
            value={config.scrollback}
            onChange={e => change({ scrollback: Number(e.target.value) })}
          />
        </label>
      </section>
      <section className='pref-section terminal-profile-settings'>
        <div className='pref-section-heading'>
          <h4>默认 Shell</h4>
          <button className='icon-button' aria-label='重新检测 Shell' title='重新检测 Shell' onClick={detect}>
            <RefreshCw size={14} />
          </button>
        </div>
        <label className='pref-row'>
          <span>新终端使用</span>
          <select
            aria-label='默认终端 Shell'
            value={chosen}
            onChange={e => {
              const id = e.target.value;
              setCustom(id === 'custom');
              if (id === 'default') change({ shell: '', arguments: [] });
              else {
                const p = profiles.find(p => p.id === id);
                if (p) change({ shell: p.shell, arguments: p.arguments });
              }
              draft.apply();
            }}
          >
            <option value='default'>系统默认</option>
            {profiles.map(p => <option value={p.id} key={p.id}>{p.label}</option>)}
            <option value='custom'>自定义程序…</option>
          </select>
        </label>
        {chosen === 'custom' && (
          <label className='runtime-header-input'>
            <span>程序路径</span>
            <div className='startup-program'>
              <input
                aria-label='终端程序'
                placeholder='例如 C:\\Program Files\\PowerShell\\7\\pwsh.exe'
                value={config.shell}
                onChange={e => change({ shell: e.target.value })}
              />
              <button
                className='icon-button'
                title='选择终端程序'
                aria-label='选择终端程序'
                onClick={() =>
                  void api.feature<string>('terminal.pick-program').then(shell => {
                    if (shell) change({ shell });
                  }).catch(e => setError(e.message))}
              >
                <FolderOpen size={15} />
              </button>
            </div>
          </label>
        )}
        <label className='runtime-header-input'>
          <span>启动选项（每行一个，可留空）</span>
          <textarea
            aria-label='终端程序参数'
            placeholder={'例如 PowerShell：\n-NoLogo\n-NoProfile'}
            value={config.arguments.join('\n')}
            onChange={e => change({ arguments: e.target.value ? e.target.value.split('\n') : [] })}
          />
        </label>
        <p className='muted-note'>
          仅应用于新建终端。
        </p>
      </section>
      {(draft.error || error) && <p role='alert' className='feature-error'>{draft.error || error}</p>}
    </div>
  );
}
