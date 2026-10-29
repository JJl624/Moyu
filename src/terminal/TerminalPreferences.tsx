import { useEffect, useState } from 'react';
import { terminalDefaults, terminalSettings, validateTerminalSettings } from './terminalSettings';
import { usePreferenceDraft } from '../preferenceDraft';
import { settingsStore } from '../settingsStore';
import { FontSelector } from '../FontSelector';
import { NumberField } from '../NumberField';
import { enumerateFonts, type FontChoice } from '../fonts';
import { api } from '../bridge';
import { profileMatches, type TerminalProfile } from './terminalProfiles';
import { FolderOpen, RefreshCw } from 'lucide-react';
export function TerminalPreferences() {
  const [fonts, setFonts] = useState<FontChoice[]>([]);
  const [profiles, setProfiles] = useState<TerminalProfile[]>([]),
    [custom, setCustom] = useState(false),
    [error, setError] = useState('');
  useEffect(() => {
    void enumerateFonts().then(setFonts).catch(() => {});
  }, []);
  const draft = usePreferenceDraft('terminal', terminalSettings(), async value => {
      validateTerminalSettings(value);
      settingsStore.setItem('moyu-terminal', JSON.stringify(value));
      await settingsStore.flush();
      window.dispatchEvent(new Event('moyu-terminal-settings'));
    }, () => {
      setCustom(false);
      return structuredClone(terminalDefaults);
    }),
    config = draft.value;
  const change = (patch: Partial<typeof config>) => draft.set(value => ({ ...value, ...patch }));
  const detect = () =>
    void api.feature<TerminalProfile[]>('terminal.shells').then(profiles => {
      setProfiles(profiles);
      setError('');
    }).catch(e => setError(e.message));
  useEffect(detect, []);
  const chosen = !config.shell && !custom
    ? 'default'
    : !custom && profiles.find(p => profileMatches(p, config.shell, config.arguments))?.id || 'custom';
  return (
    <div className='terminal-preferences compact-type-settings' {...draft.events}>
      <section className='pref-section terminal-appearance-settings'>
        <h3>字体与显示</h3>
        <div className='compact-pref-grid'>
          <div className='compact-inline-field compact-grid-wide'>
            <span>字体</span>
            <FontSelector
              label='终端字体'
              value={config.family}
              change={family => change({ family })}
              fonts={fonts}
              placeholder='跟随代码字体'
            />
          </div>
          <label className='compact-inline-field'>
            <span>字号</span>
            <div className='compact-number-unit'>
              <NumberField label='终端字号' min={8} max={36}
                value={config.fontSize} change={fontSize => change({ fontSize: Math.round(fontSize) })} />
              <small>px</small>
            </div>
          </label>
          <label className='compact-inline-field'>
            <span>行高</span>
            <div className='compact-number-unit'>
              <NumberField label='终端行高' min={1} max={2} step={.1}
                value={config.lineHeight} change={lineHeight => change({ lineHeight })} />
              <small>倍</small>
            </div>
          </label>
          <label className='compact-inline-field'>
            <span>光标样式</span>
            <select aria-label='终端光标样式' value={config.cursorStyle}
              onChange={e => {
                change({ cursorStyle: e.target.value as typeof config.cursorStyle });
                draft.apply();
              }}>
              <option value='block'>方块</option>
              <option value='underline'>下划线</option>
              <option value='bar'>竖线</option>
            </select>
          </label>
          <div className='compact-inline-field'>
            <span>光标闪烁</span>
            <button role='switch' className={'toggle ' + (config.cursorBlink ? 'on' : '')}
              aria-label='终端光标闪烁' aria-checked={config.cursorBlink}
              onClick={() => {
                change({ cursorBlink: !config.cursorBlink });
                draft.apply();
              }}><span /></button>
          </div>
          <label className='compact-inline-field'>
            <span>回滚行数</span>
            <div className='terminal-scrollback'>
              <NumberField label='终端回滚行数' min={100} max={20000} value={config.scrollback}
                change={scrollback => change({ scrollback: Math.round(scrollback) })} />
            </div>
          </label>
        </div>
      </section>
      <section className='pref-section terminal-profile-settings'>
        <div className='pref-section-heading'>
          <h4>新终端</h4>
          <button className='icon-button' aria-label='重新检测 Shell' title='重新检测 Shell' onClick={detect}>
            <RefreshCw size={14} />
          </button>
        </div>
        <div className='terminal-launch-fields'>
          <label className='compact-inline-field'>
            <span>Shell</span>
            <select aria-label='默认终端 Shell' value={chosen}
              onChange={e => {
                const id = e.target.value;
                setCustom(id === 'custom');
                if (id === 'default') change({ shell: '', arguments: [] });
                else {
                  const p = profiles.find(p => p.id === id);
                  if (p) change({ shell: p.shell, arguments: p.arguments });
                }
                draft.apply();
              }}>
              <option value='default'>系统默认</option>
              {profiles.map(p => <option value={p.id} key={p.id}>{p.label}</option>)}
              <option value='custom'>自定义程序…</option>
            </select>
          </label>
          {chosen === 'custom' && (
            <label className='compact-inline-field'>
              <span>程序路径</span>
              <div className='startup-program'>
                <input aria-label='终端程序' placeholder='Shell 可执行文件的完整路径'
                  value={config.shell} onChange={e => change({ shell: e.target.value })} />
                <button className='icon-button' title='选择终端程序' aria-label='选择终端程序'
                  onClick={() => void api.feature<string>('terminal.pick-program').then(shell => {
                    if (shell) change({ shell });
                  }).catch(e => setError(e.message))}>
                  <FolderOpen size={15} />
                </button>
              </div>
            </label>
          )}
          <label className='compact-inline-field terminal-arguments-field'>
            <span>启动参数</span>
            <textarea aria-label='终端程序参数' rows={3}
              title='每行一个参数' placeholder={'-NoLogo\n-NoProfile'}
              value={config.arguments.join('\n')}
              onChange={e => change({ arguments: e.target.value ? e.target.value.split('\n') : [] })} />
          </label>
        </div>
      </section>
      {(draft.error || error) && <p role='alert' className='feature-error'>{draft.error || error}</p>}
    </div>
  );
}
