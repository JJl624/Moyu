import { settingsStore } from '../settingsStore';
export type TerminalSettings = {
  family: string;
  fontSize: number;
  lineHeight: number;
  cursorStyle: 'block' | 'underline' | 'bar';
  cursorBlink: boolean;
  scrollback: number;
  shell: string;
  arguments: string[];
};
export const terminalDefaults: TerminalSettings = {
  family: '',
  fontSize: 14,
  lineHeight: 1.2,
  cursorStyle: 'block',
  cursorBlink: true,
  scrollback: 5000,
  shell: '',
  arguments: [],
};
export function terminalSettings(): TerminalSettings {
  try {
    return validateTerminalSettings({
      ...terminalDefaults,
      ...JSON.parse(settingsStore.getItem('moyu-terminal') || '{}'),
    });
  } catch {
    return structuredClone(terminalDefaults);
  }
}
export function validateTerminalSettings(value: TerminalSettings): TerminalSettings {
  if (
    typeof value.family !== 'string' || value.family.length > 200 || typeof value.shell !== 'string'
    || value.shell.length > 32767 || value.shell.includes('\0') || !Array.isArray(value.arguments)
    || value.arguments.length > 64 || value.arguments.some(v =>
      typeof v !== 'string' || v.length > 4000 || v.includes('\0')
    )
  ) throw Error('终端字体或程序设置无效。');
  if (
    !Number.isInteger(value.fontSize) || value.fontSize < 8 || value.fontSize > 36 || !Number.isFinite(value.lineHeight)
    || value.lineHeight < 1 || value.lineHeight > 2 || !Number.isInteger(value.scrollback) || value.scrollback < 100
    || value.scrollback > 20000 || typeof value.cursorBlink !== 'boolean'
    || !['block', 'underline', 'bar'].includes(value.cursorStyle)
  ) throw Error('终端样式设置无效。');
  return value;
}
