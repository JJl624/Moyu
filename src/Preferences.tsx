import {HistoryPreferences} from './documents/HistoryPreferences';
import {TerminalPreferences} from "./terminal/TerminalPreferences";
import './preferenceLayout.css';
import { useEffect, useRef, useState } from 'react';
import { version } from '../package.json';
import { CodePreferences, codeLanguages, type CodeLanguage, type CodePreferencesHandle } from './CodePreferences';
import { DataPreferences } from './DataPreferences';
import { enumerateFonts, type FontChoice } from './fonts';
import { FontSelector } from './FontSelector';
import { NumberField } from './NumberField';
import { WebDAVPreferences, type WebDAVPreferencesHandle } from './WebDAVPreferences';
import { flushPreferences, resetPreference } from './preferenceDraft';
import { settingsStore } from './settingsStore';
import { themes } from './themes';
export const fontRoles = [
  ['source', '源码界面'],
  ['reading', '阅读正文'],
  ['readingHeading', '阅读标题'],
  ['readingCode', '阅读代码'],
  ['files', '文件浏览器'],
  ['tabs', '文档标签页'],
  ['toolbar', '编辑工具栏'],
  ['navigation', '知识库导航'],
  ['search', '搜索界面'],
  ['sync', 'WebDAV 界面'],
  ['drawing', '绘图工具界面'],
  ['outline', '文档大纲'],
  ['status', '状态栏'],
  ['menu', '右键菜单'],
  ['settings', '设置界面'],
] as const;
export interface FontRole {
  family?: string;
  size?: number;
  scale?: number;
  lineHeight?: number;
}
export const appearanceDefaults = {
  bodyFont: 'Microsoft YaHei',
  headingFont: 'Microsoft YaHei',
  uiFont: 'Segoe UI',
  codeFont: 'Cascadia Code',
  uiSize: 13,
  codeSize: 13,
  headingScale: 1,
  width: 748,
  paragraphGap: 14,
  listGap: 8,
  sidebarWidth: 260,
  infoWidth: 242,
  accent: '',
  syntaxMarkerLight: '#8c8c8c',
  syntaxMarkerDark: '#aaaaaa',
  preset: 'frame',
  showExtensions: false,
  roleFonts: {} as Record<string, FontRole>,
};
export type Appearance = typeof appearanceDefaults;
export function loadAppearance(): Appearance {
  let input: Partial<Appearance> = {};
  try {
    input = JSON.parse(settingsStore.getItem('moyu-appearance') || '{}') || {};
  } catch { /* defaults */ }
  const result = { ...appearanceDefaults, roleFonts: {} as Record<string, FontRole> };
  result.showExtensions = input.showExtensions === true;
  for (const key of ['bodyFont', 'headingFont', 'uiFont', 'codeFont'] as const) {
    if (typeof input[key] === 'string') result[key] = input[key]!.slice(0, 100);
  }
  for (
    const [key, min, max] of [
      ['uiSize', 11, 20],
      ['codeSize', 10, 28],
      ['headingScale', 0.75, 1.5],
      ['width', 560, 1400],
      ['paragraphGap', 0, 30],
      ['listGap', 0, 24],
      ['sidebarWidth', 180, 600],
      ['infoWidth', 180, 600],
    ] as const
  ) {
    if (Number.isFinite(input[key])) result[key] = Math.max(min, Math.min(max, input[key]!));
  }
  for (const key of ['accent', 'syntaxMarkerLight', 'syntaxMarkerDark'] as const) {
    if (/^#[0-9a-f]{6}$/i.test(input[key] || '')) result[key] = input[key]!;
  }
  if (themes.some(t => t.id === input.preset)) result.preset = input.preset!;
  if (input.roleFonts && typeof input.roleFonts === 'object') {
    for (const [key] of fontRoles) {
      const v = input.roleFonts[key];
      if (v && typeof v === 'object') {
        result.roleFonts[key] = {
          ...(typeof v.family === 'string' ? { family: v.family.slice(0, 100) } : {}),
          ...(key!=='readingHeading' && Number.isFinite(v.size) ? { size: Math.min(32, Math.max(10, v.size!)) } : {}),
          ...(key==='readingHeading' && Number.isFinite(v.scale ?? v.size) ? {
            scale: Math.min(2,Math.max(0.5,v.scale ?? v.size! / (input.roleFonts.reading?.size || Number(settingsStore.getItem('moyu-fontsize') || 16) || 16)))
          } : {}),
          ...(Number.isFinite(v.lineHeight)
            ? { lineHeight: Math.min(3, Math.max(1, v.lineHeight!)) }
            : {}),
        };
      }
    }
  }
  return result;
}
export function appearanceStyle(
  v: Appearance,
  bodySize = 16,
  bodyLine = 1.75,
): React.CSSProperties {
  const font = (name: string, fallback: string) => `${JSON.stringify(name)}, ${fallback}`;
  const roles: Record<string, string> = {};
  for (const [key] of fontRoles) {
    const c = v.roleFonts[key], mono = key === 'source' || key === 'readingCode';
    const fallback = mono
      ? v.codeFont
      : key === 'reading'
      ? v.bodyFont
      : key === 'readingHeading'
      ? v.headingFont
      : v.uiFont;
    roles['--font-' + key] = font(
      c?.family || fallback,
      mono ? 'monospace' : 'system-ui, sans-serif',
    );
    roles['--size-' + key] = (c?.size || (key === 'reading'
      ? bodySize
      : mono
      ? v.codeSize
      : v.uiSize)) + 'px';
    roles['--line-' + key] = String(c?.lineHeight || (key.startsWith('reading') ? bodyLine : 1.7));
  }
  return {
    ...roles,
    '--font-ui': font(v.uiFont, 'system-ui, sans-serif'),
    '--font-mono': font(v.codeFont, 'monospace'),
    '--body-font': font(v.bodyFont, 'system-ui, sans-serif'),
    '--heading-font': font(v.headingFont, 'system-ui, sans-serif'),
    '--ui-size': v.uiSize + 'px',
    '--code-size': v.codeSize + 'px',
    '--heading-scale': v.headingScale,
    '--heading-scale-reading': v.roleFonts.readingHeading?.scale || v.headingScale,
    '--document-width': v.width + 'px',
    '--paragraph-gap': v.paragraphGap + 'px',
    '--list-gap': v.listGap + 'px',
    '--sidebar-width': v.sidebarWidth + 'px',
    '--info-width': v.infoWidth + 'px',
    '--syntax-marker-light': v.syntaxMarkerLight,
    '--syntax-marker-dark': v.syntaxMarkerDark,
    ...(v.accent ? { '--accent': v.accent } : {}),
  } as React.CSSProperties;
}
interface Props {
  root?: string;
  initialCategory?: string;
  value: Appearance;
  change(v: Appearance): void;
  theme: 'dark' | 'light';
  setTheme(v: 'dark' | 'light'): void;
  fontSize: number;
  setFontSize(v: number): void;
  lineHeight: number;
  setLineHeight(v: number): void;
  formatbar: boolean;
  setFormatbar(v: boolean): void;
  savePolicy: import('./useWorkspace').SavePolicy;
  saveDelay: number;
  setSaveDelay(value:number): void;
  setSavePolicy(v: import('./useWorkspace').SavePolicy): void;
  wide: boolean;
  setWide(v: boolean): void;
}
export function Preferences(p: Props) {
  const webdavPreferences = useRef<WebDAVPreferencesHandle>(null);
  const codePreferences = useRef<CodePreferencesHandle>(null);
  const initialLanguage = codeLanguages.find(([key, label]) => key === p.initialCategory || label === p.initialCategory)?.[0];
  const [codeLanguage, setCodeLanguage] = useState<CodeLanguage>(initialLanguage || 'general');
  const [category, setCategory] = useState(initialLanguage ? '代码' : p.initialCategory || '字体与排版'),
    [fonts, setFonts] = useState<FontChoice[]>([]),
    [fontError, setFontError] = useState('');
  const [region, setRegion] = useState<(typeof fontRoles)[number][0]>('source');
  const regionLabel = fontRoles.find(([key]) => key === region)![1];
  const mono = region === 'source' || region === 'readingCode',
    body = region === 'reading' || region === 'readingHeading';
  const heading=region==='readingHeading';
  const inherited = {
    family: '',
    size: body ? p.fontSize : mono ? p.value.codeSize : p.value.uiSize,
    scale: p.value.headingScale,
    lineHeight: region.startsWith('reading') ? p.lineHeight : 1.7,
  };
  const regionValue = { ...inherited, ...p.value.roleFonts[region] };
  const regionFont = mono
    ? p.value.codeFont
    : region === 'reading'
    ? p.value.bodyFont
    : region === 'readingHeading'
    ? p.value.headingFont
    : p.value.uiFont;
  const refreshFonts = async (refresh = false) => {
    try {
      setFonts(await enumerateFonts(refresh));
      setFontError('');
    } catch (e) {
      setFontError((e as Error).message);
    }
  };
  useEffect(() => {
    void refreshFonts();
  }, []);
  const change = <K extends keyof Appearance>(key: K, value: Appearance[K]) =>
    p.change({ ...p.value, [key]: value });
  const regionChange = (patch: Partial<FontRole>) =>
    change('roleFonts', {
      ...p.value.roleFonts,
      [region]: { ...p.value.roleFonts[region], ...patch },
    });
  const slider = (
    label: string,
    value: number,
    min: number,
    max: number,
    step: number,
    action: (v: number) => void,
    unit = '',
  ) => (
    <div className='pref-row'>
      <span>{label}</span>
      <div>
        <input
          aria-label={label}
          type='range'
          value={value}
          min={min}
          max={max}
          step='any'
          onChange={e =>
            action(Number((Math.round(Number(e.target.value) / step) * step).toFixed(4)))}
        />
        <NumberField
          label={label + '数值'}
          value={value}
          min={min}
          max={max}
          step={step}
          change={action}
        />
        <small>{unit}</small>
      </div>
    </div>
  );
  const regionBase = mono
    ? '代码字体'
    : region === 'reading'
    ? '正文字体'
    : region === 'readingHeading'
    ? '标题字体'
    : '界面字体';
  const inheritedSize = heading ? '标题比例' : body ? '文字大小' : mono ? '代码字号' : '界面字号';
  const toggle = (label: string, checked: boolean, action: (v: boolean) => void) => (
    <div className='pref-row'>
      <span>{label}</span>
      <button
        className={`toggle ${checked ? 'on' : ''}`}
        role='switch'
        aria-label={label}
        aria-checked={checked}
        onClick={() => action(!checked)}
      >
        <span />
      </button>
    </div>
  );
  return (
    <div className='preferences'>
      <nav className='pref-tabs'>
        {['字体与排版', '界面', '编辑', 'WebDAV', '终端', '代码', '数据与运行环境'].map(c => (
          <button
            key={c}
            className={category === c ? 'active' : ''}
            onClick={() => void flushPreferences().then(() => setCategory(c)).catch(() => {})}
          >
            {c}
          </button>
        ))}
      </nav>
      <div className={'pref-content' + (category === '代码' ? ' code-pref-content' : '')}>
        {category === '字体与排版' && (
          <>
            <div className='pref-section-heading'>
              <h3>默认字体</h3>
              <button className='text-button' onClick={() => void refreshFonts(true)}>
                刷新字体列表
              </button>
            </div>

            {fontError && <p role='status'>{fontError}</p>}
            <div className='default-font-grid'>
              {([['bodyFont', '正文字体'], ['headingFont', '标题字体'], ['codeFont', '代码字体'], [
                'uiFont',
                '界面字体',
              ]] as const).map(([key, label]) => (
                <div className='default-font-field' key={key}>
                  <span>{label}</span>
                  <FontSelector
                    label={label}
                    value={p.value[key]}
                    fonts={fonts}
                    change={name => change(key, name)}
                  />
                  {key==='bodyFont'?slider('文字大小',p.fontSize,12,28,1,p.setFontSize,'px')
                    :key==='headingFont'?slider('标题比例',p.value.headingScale,0.75,1.5,0.05,v=>change('headingScale',v))
                    :key==='codeFont'?slider('代码字号',p.value.codeSize,10,28,1,v=>change('codeSize',v),'px')
                    :slider('界面字号',p.value.uiSize,11,20,1,v=>change('uiSize',v),'px')}
                </div>
              ))}
            </div>
            <section className='pref-section'>
              <h3>区域字体</h3>
              <div className='font-region-layout'>
                <nav aria-label='字体区域'>
                  <strong>编辑区</strong>
                  {fontRoles.slice(0, 4).map(([key, label]) => (
                    <button
                      aria-label={label}
                      key={key}
                      className={region === key ? 'selected' : ''}
                      onClick={() => setRegion(key)}
                    >
                      {label}
                    </button>
                  ))}
                  <strong>应用界面</strong>
                  {fontRoles.slice(4).map(([key, label]) => (
                    <button
                      aria-label={label}
                      key={key}
                      className={region === key ? 'selected' : ''}
                      onClick={() => setRegion(key)}
                    >
                      {label}
                    </button>
                  ))}
                </nav>
                <div className='font-region-controls' key={region}>
                  <div className='pref-section-heading'>
                    <h4>{regionLabel}</h4>
                    <small>{p.value.roleFonts[region] ? '自定义' : '继承默认'}</small>
                  </div>
                  <div className='pref-row'>
                    <span>字体</span>
                    <FontSelector
                      label={regionLabel + '字体'}
                      value={regionValue.family || ''}
                      inherited={regionFont}
                      fonts={fonts}
                      change={family => regionChange({ family })}
                    />
                  </div>
                  <div className='pref-row'>
                    <span>{heading?'标题比例':'字号'}</span>
                    <div>
                      <NumberField
                        label={regionLabel + (heading?'比例':'字号')}
                        value={heading?regionValue.scale:regionValue.size}
                        min={heading?0.5:10}
                        max={heading?2:32}
                        step={heading?0.05:1}
                        change={value => regionChange(heading?{scale:value}:{size:value})}
                      />
                      {!heading&&<small>px</small>}
                    </div>
                  </div>
                  <div className='pref-row'>
                    <span>行高</span>
                    <NumberField
                      label={regionLabel + '行高'}
                      value={regionValue.lineHeight}
                      min={1}
                      max={3}
                      step={0.1}
                      change={lineHeight => regionChange({ lineHeight })}
                    />
                  </div>
                  <div className='font-inheritance' aria-label='当前字体继承关系'>
                    <span>
                      字体：{regionValue.family
                        ? '自定义 ' + regionValue.family
                        : '继承 ' + regionBase + '（' + regionFont + '）'}
                    </span>
                    <span>
                      {heading?'比例':'字号'}：{(heading?p.value.roleFonts[region]?.scale:p.value.roleFonts[region]?.size)
                        ? '自定义'
                        : '继承 ' + inheritedSize}（{heading?regionValue.scale:regionValue.size}{heading?'':'px'}）
                    </span>
                    <span>
                      行高：{p.value.roleFonts[region]?.lineHeight
                        ? '自定义'
                        : region.startsWith('reading')
                        ? '继承正文行高'
                        : '默认界面行高'}（{regionValue.lineHeight}）
                    </span>
                  </div>
                  <button
                    className='secondary-button inherit-font'
                    disabled={!p.value.roleFonts[region]}
                    onClick={() => {
                      const roleFonts = { ...p.value.roleFonts };
                      delete roleFonts[region];
                      change('roleFonts', roleFonts);
                    }}
                  >
                    恢复继承
                  </button>
                </div>
              </div>
            </section>
            <section className='pref-section'>
              <h3>排版</h3>
              {slider('正文行高', p.lineHeight, 1.3, 2.4, 0.05, p.setLineHeight)}
              {slider(
                '段落间距',
                p.value.paragraphGap,
                0,
                30,
                1,
                v => change('paragraphGap', v),
                'px',
              )}
              {slider('列表间距', p.value.listGap, 0, 24, 1, v => change('listGap', v), 'px')}
              {slider('正文宽度', p.value.width, 560, 1400, 20, v => change('width', v), 'px')}
            </section>
            <section className='pref-section'>
              <h3>语法标记</h3>
              {([['syntaxMarkerLight', '浅色模式'], ['syntaxMarkerDark', '深色模式']] as const).map(([key, label]) => (
                <label className='pref-row' key={key}>
                  <span>{label}</span>
                  <div>
                    <input
                      type='color'
                      aria-label={label + '标记颜色'}
                      value={p.value[key]}
                      onChange={e => change(key, e.target.value)}
                    />
                    <button
                      type='button'
                      className='text-button'
                      aria-label={'恢复' + label + '标记颜色'}
                      disabled={p.value[key] === appearanceDefaults[key]}
                      onClick={() => change(key, appearanceDefaults[key])}
                    >
                      恢复默认
                    </button>
                  </div>
                </label>
              ))}
            </section>
          </>
        )}
        {category === '界面' && (
          <>
            <div className='pref-section-heading'>
              <h3>配色</h3>
            </div>
            <div className='theme-grid'>
              {themes.map(t => (
                <button
                  key={t.id}
                  aria-label={t.name}
                  className={p.value.preset === t.id ? 'selected' : ''}
                  onClick={() => change('preset', t.id)}
                >
                  <span
                    className='theme-swatch'
                    style={{
                      background: t[p.theme][0],
                      color: t[p.theme][4],
                      borderColor: t[p.theme][6],
                    }}
                  >
                    Aa
                  </span>
                  {t.name}
                </button>
              ))}
            </div>
            <div className='pref-row'>
              <span>外观主题</span>
              <div className='theme-picker'>
                {(['dark', 'light'] as const).map(t => (
                  <button
                    key={t}
                    className={p.theme === t ? 'selected' : ''}
                    onClick={() => p.setTheme(t)}
                  >
                    {t === 'dark' ? '深色' : '浅色'}
                  </button>
                ))}
              </div>
            </div>
            <label className='pref-row'>
              <span>强调色</span>
              <div>
                <input
                  type='color'
                  aria-label='强调色'
                  value={p.value.accent
                    || (themes.find(t => t.id === p.value.preset) || themes[0])[p.theme][6]}
                  onChange={e => change('accent', e.target.value)}
                />
                <button className='text-button' onClick={() => change('accent', '')}>
                  跟随主题
                </button>
              </div>
            </label>
            {slider('侧栏宽度', p.value.sidebarWidth, 180, 600, 1, v =>
              change('sidebarWidth', v), 'px')}
            {slider('文档信息宽度', p.value.infoWidth, 180, 600, 1, v => change('infoWidth', v), 'px')}
            {toggle('宽屏写作', p.wide, p.setWide)}
            {toggle('显示文件扩展名', p.value.showExtensions, v =>
              change('showExtensions', v))}
          </>
        )}
        {category === '编辑' && (
          <>
            <h3>编辑行为</h3>
            <label className='pref-row'>
              <span>保存方式</span>
              <select
                aria-label='保存方式'
                value={p.savePolicy}
                onChange={e =>
                  p.setSavePolicy(e.target.value as import('./useWorkspace').SavePolicy)}
              >
                <option value='manual'>手动保存</option>
                <option value='close'>离开文档时保存</option>
                <option value='realtime'>实时自动保存</option>
              </select>
            </label>
            {p.savePolicy==='close' && <p className='muted-note'>切换标签页、关闭文档或退出时保存。</p>}
            {p.savePolicy==='realtime' && <><label className='pref-row'><span>停止输入后保存（毫秒）</span><NumberField label='自动保存延迟' value={p.saveDelay} min={200} max={10000} change={p.setSaveDelay}/></label><p className='muted-note'>停止输入后保存；切换标签页、关闭文档或退出时立即保存。</p></>}
            {toggle('常驻格式工具栏', p.formatbar, p.setFormatbar)}
            <HistoryPreferences />
          </>
        )}
        {category === '数据与运行环境' && <DataPreferences />}
        {category === 'WebDAV' && <WebDAVPreferences ref={webdavPreferences} root={p.root || ''} />}
        {category==='终端'&&<TerminalPreferences/>}
        {category === '代码' && <CodePreferences ref={codePreferences} language={codeLanguage} change={setCodeLanguage} />}
      </div>
      <div className='pref-bottom'>
        <small>墨屿 Moyu {version} · <button className='pref-update-button' onClick={() => window.dispatchEvent(new Event('moyu-check-update'))}>检查更新</button></small>
        {category !== '数据与运行环境' && <button
          className='secondary-button'
          onClick={() => {
            if(category==='终端'){void resetPreference('terminal').catch(()=>{});return;}
            if (category === 'WebDAV') { webdavPreferences.current?.reset(); return; }
            if (category === '代码') { void codePreferences.current?.reset().catch(() => {}); return; }
            if (category === '编辑') { p.setFormatbar(false); p.setSavePolicy('realtime');p.setSaveDelay(900);void resetPreference('history').catch(() => {});return; }
            if (category === '界面') { p.change({...p.value,preset:appearanceDefaults.preset,accent:'',sidebarWidth:appearanceDefaults.sidebarWidth,infoWidth:appearanceDefaults.infoWidth,showExtensions:false});p.setTheme('dark');p.setWide(false);return; }
            p.change({ ...p.value, ...Object.fromEntries(Object.entries(appearanceDefaults).filter(([key]) => !['preset','accent','sidebarWidth','infoWidth','showExtensions'].includes(key))), roleFonts: {} });
            p.setFontSize(16);
            p.setLineHeight(1.75);

          }}
        >
          恢复默认
        </button>}
      </div>
    </div>
  );
}
