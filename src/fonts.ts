import { api } from './bridge';
export interface FontChoice {
  family: string;
  label: string;
  search: string;
}
let pending: Promise<FontChoice[]> | undefined;
export function enumerateFonts(refresh = false): Promise<FontChoice[]> {
  if (refresh) pending = undefined;
  return pending ||= (async () => {
    const names = new Set<string>();
    const query =
      (window as unknown as {
        queryLocalFonts?: () => Promise<{ family: string; fullName: string }[]>;
      }).queryLocalFonts;
    const tasks = await Promise.allSettled([
      query ? query.call(window) : Promise.resolve([]),
      api.desktop ? api.feature<string[]>('fonts.list', { refresh }) : Promise.resolve([]),
    ]);
    if (tasks[0].status === 'fulfilled') { for (const font of tasks[0].value) {
        names.add(font.family);
      } }
    if (tasks[1].status === 'fulfilled') {
      for (const name of tasks[1].value) if (typeof name === 'string') names.add(name);
    }
    if (!names.size) throw new Error('无法读取本机字体，仍可手动输入字体名称。');
    const aliases: Record<string, string> = {
      'Microsoft YaHei': '微软雅黑',
      'Microsoft YaHei UI': '微软雅黑 UI',
      SimSun: '宋体',
      NSimSun: '新宋体',
      SimHei: '黑体',
      KaiTi: '楷体',
      FangSong: '仿宋',
      'Microsoft JhengHei': '微软正黑体',
      'Arial': 'Arial',
      'Segoe UI': 'Segoe UI',
    };
    return [...names].filter(Boolean).sort((a, b) => a.localeCompare(b, 'zh-CN')).map(family => ({
      family,
      label: aliases[family] && aliases[family] !== family
        ? `${aliases[family]} / ${family}`
        : family,
      search: (family + ' ' + (aliases[family] || '')).toLocaleLowerCase(),
    }));
  })();
}
