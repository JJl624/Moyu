import { useEffect, useRef, useState } from 'react';
import { settingsStore } from './settingsStore';
const editors = new Map<string, { flush(): Promise<void>; reset?(): Promise<void> }>();
export async function flushPreferences() {
  for (const editor of editors.values()) await editor.flush();
  await settingsStore.flush();
}
export async function resetPreference(key: string) { await editors.get(key)?.reset?.(); }
// All persisted form drafts share one lifecycle. Blur/Enter commits text;
// options commit directly. Equal snapshots and overlapping commits coalesce.
export function usePreferenceDraft<T>(key: string, initial: T, write: (value: T) => Promise<unknown>, defaults?: () => T) {
  const [value, render] = useState(initial), [error, setError] = useState(''), [saving, setSaving] = useState(false);
  const current = useRef(initial), saved = useRef(JSON.stringify(initial)), writer = useRef(write), resetter = useRef(defaults);
  const count = useRef(0), queue = useRef(Promise.resolve());
  const last = useRef<{ text: string; job: Promise<void> } | null>(null);
  const mounted = useRef(true);
  writer.current = write; resetter.current = defaults;
  const set = (next: T | ((value: T) => T)) => {
    current.current = typeof next === 'function' ? (next as (v: T) => T)(current.current) : next;
    render(current.current); setError('');
  };
  const load = (next: T) => { set(next); saved.current = JSON.stringify(next); };
  const commit = (): Promise<void> => {
    const snapshot = current.current, text = JSON.stringify(snapshot);
    if (!count.current && text === saved.current) return Promise.resolve();
    if (last.current?.text === text) return last.current.job;
    count.current++;
    setSaving(true);
    const job = queue.current.catch(() => {}).then(async () => {
      if (text === saved.current) return;
      await writer.current(snapshot); saved.current = text;
      if (mounted.current) setError('');
    }).catch(e => { if (mounted.current) setError(e.message); throw e; }).finally(() => {
      count.current--; if (last.current?.job === job) last.current = null;
      if (mounted.current) setSaving(count.current > 0);
    });
    last.current = { text, job }; queue.current = job;
    return job;
  };
  const live = useRef({ commit, set }); live.current = { commit, set };
  useEffect(() => {
    mounted.current = true;
    const registration = { flush: () => live.current.commit(), reset: async () => {
      if (resetter.current) { live.current.set(resetter.current()); await live.current.commit(); }
    } };
    editors.set(key, registration);
    return () => { mounted.current = false; if (editors.get(key) === registration) editors.delete(key); };
  }, [key]);
  return { value, set, load, commit, error, saving, changed: JSON.stringify(value) !== saved.current,
    apply: () => { void commit().catch(() => {}); },
    events: { onBlur: () => { void commit().catch(() => {}); }, onKeyDown: (event: React.KeyboardEvent) => {
      if (event.key === 'Enter' && event.target instanceof HTMLInputElement && !event.nativeEvent.isComposing) {
        event.preventDefault(); (event.target as HTMLElement).blur();
      }
    } },
  };
}
