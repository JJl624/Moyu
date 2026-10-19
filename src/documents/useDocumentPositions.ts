import { useEffect, useLayoutEffect, useRef } from 'react';
import type { EditorSelection } from '../editorTypes';

export function useDocumentPositions(root: string | undefined, tabs: string[]) {
  const selections = useRef(new Map<string, EditorSelection>());
  const scrollPositions = useRef(new Map<string, number>());
  const modeSelections = useRef(new Map<string, EditorSelection>());
  const forget = (path: string) => {
    selections.current.delete(path);
    for (const positions of [scrollPositions.current, modeSelections.current]) {
      for (const key of positions.keys()) if (key.startsWith(path + '\0')) positions.delete(key);
    }
  };
  useEffect(() => {
    selections.current.clear();
    scrollPositions.current.clear();
    modeSelections.current.clear();
  }, [root]);
  useLayoutEffect(() => {
    const opened = new Set(tabs);
    for (const path of selections.current.keys()) if (!opened.has(path)) forget(path);
    for (const positions of [scrollPositions.current, modeSelections.current]) {
      for (const key of positions.keys()) if (!opened.has(key.split('\0')[0])) positions.delete(key);
    }
  }, [tabs]);
  return { selections, scrollPositions, modeSelections, forget };
}
