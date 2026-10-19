import { useEffect, useState } from 'react';
import { api } from './bridge';
import { type FontChoice } from './fonts';
import { fontFaceBytes } from '../shared/font-face.mjs';
import { FontSelector } from './FontSelector';
import { settingsStore } from './settingsStore';
export interface DrawingFont {
  id: number;
  family: string;
  face?: string;
}
interface LocalFace {
  family: string; fullName: string; style: string; postscriptName: string; blob(): Promise<Blob>;
}
async function localFaces(): Promise<LocalFace[]> {
  const query = (window as unknown as { queryLocalFonts?: () => Promise<LocalFace[]> }).queryLocalFonts;
  if (!query) throw new Error('当前环境无法读取本机字体。');
  return query.call(window);
}
const key = 'moyu-drawing-fonts';
async function resetDrawings(ids: number[], exclude: string) {
  const documents = await api.feature('fonts.reset-drawings', { ids, exclude });
  window.dispatchEvent(new CustomEvent('moyu-drawing-fonts-reset', { detail: { ids, documents } }));
}
export function customDrawingFonts(): DrawingFont[] {
  try {
    return JSON.parse(settingsStore.getItem(key) || '[]').filter((f: DrawingFont) =>
      Number.isInteger(f.id) && f.id >= 10000 && typeof f.family === 'string'
    );
  } catch {
    return [];
  }
}
let initialized: Promise<DrawingFont[]> | undefined;
const registered = new Map<number, string>();
export async function initializeDrawingFonts(
  refresh = false,
  exclude = '',
): Promise<DrawingFont[]> {
  if (refresh) initialized = undefined;
  return initialized ||= (async () => {
    if (!(window as unknown as {queryLocalFonts?: unknown}).queryLocalFonts) return customDrawingFonts();
    const local = await localFaces(), { MoyuFonts } = await import('moyu-excalidraw');
    const valid: DrawingFont[] = [], removed: number[] = [];
    for (const font of customDrawingFonts()) {
      const file = font.face ? local.find(f => f.postscriptName === font.face)
        : local.find(f => f.family === font.family && /regular|normal|常规/i.test(f.style))
          || local.find(f => f.family === font.family || f.fullName === font.family);
      if (!file) {
        removed.push(font.id);
        MoyuFonts.remove(font.id);
        registered.delete(font.id);
        continue;
      }
      const exact = { ...font, family: file.fullName, face: file.postscriptName };
      if (registered.get(font.id) !== file.postscriptName) {
        if (registered.has(font.id)) MoyuFonts.remove(font.id);
        const bytes = await fontFaceBytes(await file.blob(), file.postscriptName);
        await MoyuFonts.register(font.id, exact.family, bytes);
        registered.set(font.id, file.postscriptName);
      }
      valid.push(exact);
    }
    for (const [id] of registered) {
      if (!valid.some(f => f.id === id)) {
        MoyuFonts.remove(id);
        registered.delete(id);
      }
    }
    settingsStore.setItem(key, JSON.stringify(valid));
    await settingsStore.flush();
    if (removed.length && api.desktop) await resetDrawings(removed, exclude);
    return valid;
  })().catch(e => {
    initialized = undefined;
    throw e;
  });
}
export function DrawingFonts(
  { path, beforeChange, onChange, onClose }: {
    path: string;
    beforeChange(): Promise<void>;
    onChange(fonts: DrawingFont[], removed?: number): void;
    onClose(): void;
  },
) {
  const [fonts, setFonts] = useState<FontChoice[]>([]),
    [custom, setCustom] = useState(customDrawingFonts),
    [selected, setSelected] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  useEffect(() => {
    void localFaces().then(available => {
      setFonts(available.sort((a, b) => a.fullName.localeCompare(b.fullName, 'zh-CN') || a.style.localeCompare(b.style)).map(font => ({
        family: font.postscriptName,
        label: font.fullName + '（' + font.style + '）',
        search: [font.family, font.fullName, font.style, font.postscriptName].join(' ').toLocaleLowerCase(),
      })));
    }).catch(e => setError(e.message));
    void initializeDrawingFonts(true, path).then(f => {
      setCustom(f);
      onChange(f);
    }).catch(e => setError(e.message));
  }, []);
  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    try {
      await beforeChange();
      await action();
      setError('');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const add = () =>
    run(async () => {
      if (!fonts.some(f => f.family === selected)) throw new Error('请选择本机字体。');
      let id = 10000;
      for (const c of selected) id = ((id * 31 + c.charCodeAt(0)) >>> 0) % 100000000 + 10000;
      while (custom.some(font => font.id === id)) id++;
      const file = (await localFaces()).find(f => f.postscriptName === selected);
      if (!file) throw new Error('所选字体已不在本机。');
      const next = [...custom, { id, family: file.fullName, face: file.postscriptName }];
      settingsStore.setItem(key, JSON.stringify(next));
      try {
        const valid = await initializeDrawingFonts(true, path);
        setCustom(valid);
        onChange(valid);
      } catch (error) {
        settingsStore.setItem(key, JSON.stringify(custom));
        await initializeDrawingFonts(true, path);
        throw error;
      }
    });
  const remove = (font: DrawingFont) =>
    run(async () => {
      const next = custom.filter(f => f.id !== font.id);
      settingsStore.setItem(key, JSON.stringify(next));
      await settingsStore.flush();
      await initializeDrawingFonts(true, path);
      await resetDrawings([font.id], path);
      setCustom(next);
      onChange(next, font.id);
    });
  return (
    <div className='drawing-font-manager'>
      <header>
        <strong>绘图字体管理</strong>
        <button onClick={onClose}>关闭</button>
      </header>
      <p className='muted-note'>移除字体后，相关文字改用 Excalifont。</p>
      <div className='pref-row'>
        <FontSelector
          label='添加绘图字体'
          placeholder='搜索或选择本机字体'
          fonts={fonts}
          value={selected}
          change={setSelected}
        />
        <button
          disabled={busy || !selected || custom.some(f => f.face === selected)}
          onClick={() => void add()}
        >
          添加
        </button>
      </div>
      <h4>自定义字体</h4>
      {custom.map(font => (
        <div className='pref-row' key={font.id}>
          <span style={{ fontFamily: font.family }}>{font.family}</span>
          <button disabled={busy} onClick={() => void remove(font)}>移除</button>
        </div>
      ))}
      {!custom.length && <p className='muted-note'>尚未添加</p>}
      {error && <p role='alert'>{error}</p>}
    </div>
  );
}
