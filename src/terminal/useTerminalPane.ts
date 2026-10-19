import { useEffect, useState } from 'react';
import { api } from '../bridge';
import { settingsStore } from '../settingsStore';

export function useTerminalPane() {
  const [terminalCount, setTerminalCount] = useState(0);
  const [terminalMounted, setTerminalMounted] = useState(false),
    [terminalVisible, setTerminalVisible] = useState(false),
    [terminalDirection, setTerminalDirection] = useState<'below' | 'right'>(() =>
      settingsStore.getItem('moyu-terminal-direction') === 'right' ? 'right' : 'below'
    ),
    [terminalSizes, setTerminalSizes] = useState(() => {
      const read = (key: string, fallback: number) => {
        const value = Number(settingsStore.getItem(key));
        return Number.isFinite(value) && value >= 130 && value <= 3000 ? value : fallback;
      };
      return { below: read('moyu-terminal-height', 260), right: read('moyu-terminal-width', 420) };
    });
  useEffect(() => {
    if (!api.desktop) return;
    return api.onTerminal?.(event => {
      if (event.type === 'exit') {
        void api.feature<unknown[]>('terminal.list').then(list => {
          setTerminalCount(list.length);
          if (!list.length) setTerminalVisible(false);
        }).catch(() => {});
      }
    });
  }, []);
  useEffect(() => {
    settingsStore.setItem('moyu-terminal-direction', terminalDirection);
  }, [terminalDirection]);
  useEffect(() => {
    settingsStore.setItem('moyu-terminal-height', String(terminalSizes.below));
    settingsStore.setItem('moyu-terminal-width', String(terminalSizes.right));
  }, [terminalSizes]);
  const toggleTerminal = () => {
    setTerminalMounted(true);
    setTerminalVisible(v => !v);
  };
  return {
    terminalCount,
    setTerminalCount,
    terminalMounted,
    terminalVisible,
    setTerminalVisible,
    terminalDirection,
    setTerminalDirection,
    terminalSizes,
    setTerminalSizes,
    toggleTerminal,
  };
}
