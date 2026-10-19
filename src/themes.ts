export const themes = [
  { id: 'frame', name: 'Frame', dark: ['#1d1f24','#191b20','#15171b','#23262d','#d5d7de','#eeeff4','#abb8fa'], light: ['#ffffff','#f6f7f9','#f0f1f4','#f5f6fa','#454c5e','#252d40','#6575bf'] },
  { id: 'nord', name: 'Nord', dark: ['#2e3440','#292e39','#242933','#3b4252','#d8dee9','#eceff4','#88c0d0'], light: ['#eceff4','#e5e9f0','#d8dee9','#ffffff','#434c5e','#2e3440','#5e81ac'] },
  { id: 'paper', name: '纸张', dark: ['#26241f','#211f1b','#1c1a17','#302d27','#d7cfbb','#f0e6cf','#c9ad7e'], light: ['#faf7ef','#f1ede2','#e9e3d6','#fffdf7','#514a3c','#302b23','#997b47'] },
  { id: 'github', name: 'GitHub', dark: ['#0d1117','#161b22','#0a0e13','#21262d','#c9d1d9','#f0f6fc','#58a6ff'], light: ['#ffffff','#f6f8fa','#eaeef2','#f6f8fa','#24292f','#1f2328','#0969da'] },
  { id: 'dracula', name: 'Dracula', dark: ['#282a36','#242631','#20222c','#343746','#f8f8f2','#f8f8f2','#bd93f9'], light: ['#faf8ff','#f0ecf8','#e8e1f2','#ffffff','#4b435c','#342945','#8462bb'] },
  { id: 'solarized', name: 'Solarized', dark: ['#002b36','#00252e','#001f27','#073642','#93a1a1','#eee8d5','#2aa198'], light: ['#fdf6e3','#eee8d5','#e8e1cc','#fffbf0','#586e75','#073642','#268bd2'] },
  { id: 'forest', name: '森林', dark: ['#1d2721','#18211c','#141b17','#28352d','#d1dfd3','#edf5ed','#a3be8c'], light: ['#f5f8f2','#eaf0e5','#dfe8d8','#ffffff','#405044','#253829','#5b8256'] },
  { id: 'rose', name: '玫瑰松', dark: ['#191724','#1f1d2e','#161421','#26233a','#e0def4','#f5edf6','#ebbcba'], light: ['#faf4ed','#f2e9e1','#e9dfd6','#fffaf3','#575279','#393552','#b4637a'] },
];
export function paletteStyle(id: string, mode: 'dark' | 'light') {
  const [bg, sidebar, rail, surface, text, heading, accent] = (themes.find(t => t.id === id) || themes[0])[mode];
  const light = mode === 'light';
  return { '--bg': bg, '--sidebar': sidebar, '--rail': rail, '--titlebar': rail, '--surface': surface, '--elevated': surface,
    '--text': text, '--heading': heading, '--accent': accent, '--secondary': light ? '#727985' : '#a1a7b3', '--muted': light ? '#7f8590' : '#838997',
    '--hover': light ? '#26324509' : '#ffffff09', '--selected': accent + '18', '--accent-dim': accent + '20',
    '--border': light ? '#26324515' : '#ffffff12', '--border-strong': light ? '#26324528' : '#ffffff28', '--logo-ink': bg,
    '--green': light ? '#37846a' : '#87bca7', '--danger': light ? '#ba4353' : '#e49197', '--mark-bg':light?'#ffe694':'#66551b' } as React.CSSProperties;
}
