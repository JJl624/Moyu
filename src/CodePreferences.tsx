import { forwardRef, useEffect, useId, useImperativeHandle, useRef, useState } from 'react';
import { CodeFormattingPreferences } from './CodeFormatting';
import { NumberField } from './NumberField';
import { PythonPreferences } from './PythonPreferences';
import { RuntimePreferences } from './RuntimePreferences';
import { RuntimeSection } from './runtime-settings/RuntimeLayout';
import { codeIndentWidth, setCodeIndentWidth } from './editor/codeIndentation';
import { flushPreferences, resetPreference } from './preferenceDraft';
import './codePreferences.css';

export const codeLanguages = [
  ['general', '通用'], ['python', 'Python'], ['javascript', 'JavaScript'], ['clang', 'C / C++'],
  ['csharp', 'C#'], ['java', 'Java'], ['sql', 'SQL'], ['lua', 'Lua'], ['ruby', 'Ruby'], ['bash', 'Bash'],
] as const;
export type CodeLanguage = typeof codeLanguages[number][0];
export interface CodePreferencesHandle { reset(): Promise<void>; }

export const CodePreferences = forwardRef<CodePreferencesHandle, {
  language: CodeLanguage;
  change(language: CodeLanguage): void;
}>(function CodePreferences({ language, change }, ref) {
  const [indent, setIndent] = useState(codeIndentWidth), [changing, setChanging] = useState(false);
  const navigation = useRef<HTMLDivElement>(null), pending = useRef(false), id = useId();
  const focusTarget = useRef<CodeLanguage | null>(null);
  useEffect(() => {
    if (changing || !focusTarget.current) return;
    const button = navigation.current?.querySelector<HTMLButtonElement>(`[data-language="${focusTarget.current}"]`);
    button?.focus();
    button?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    navigation.current?.closest('.code-preferences')?.querySelector(':scope > [role=tabpanel]')?.scrollTo({ top: 0 });
    focusTarget.current = null;
  }, [language, changing]);
  useImperativeHandle(ref, () => ({
    async reset() {
      if (language === 'general') {
        setIndent(2);
        setCodeIndentWidth(2);
        await resetPreference('formatting');
      } else await resetPreference(language === 'python' ? 'Python' : language);
    },
  }), [language]);
  const select = async (next: CodeLanguage) => {
    if (pending.current || next === language) return;
    pending.current = true;
    setChanging(true);
    try {
      await flushPreferences();
      focusTarget.current = next;
      change(next);
    } catch {
      const field = navigation.current?.closest('.code-preferences')?.querySelector<HTMLElement>(
        language === 'general' ? '.dprint-json' : 'input:invalid,textarea:invalid',
      );
      if (field?.getClientRects().length) {
        field.focus();
        field.scrollIntoView({ block: 'nearest' });
      } else focusTarget.current = language;
    } finally {
      pending.current = false;
      setChanging(false);
    }
  };
  return (
    <div className='code-preferences'>
      <div className='code-language-bar'>
      <div className='code-language-tabs' role='tablist' aria-label='代码语言' ref={navigation}
        onKeyDown={event => {
          const index = codeLanguages.findIndex(([key]) => key === language);
          const next = event.key === 'ArrowRight' ? (index + 1) % codeLanguages.length
            : event.key === 'ArrowLeft' ? (index + codeLanguages.length - 1) % codeLanguages.length
            : event.key === 'Home' ? 0 : event.key === 'End' ? codeLanguages.length - 1 : -1;
          if (next >= 0) { event.preventDefault(); void select(codeLanguages[next][0]); }
        }}>
        {codeLanguages.map(([key, label]) => (
          <button key={key} role='tab' id={id + '-' + key} data-language={key} title={key === 'javascript' ? 'JavaScript / TypeScript' : label}
            aria-controls={id + '-panel'} aria-selected={language === key}
            tabIndex={language === key ? 0 : -1} disabled={changing}
            onClick={() => void select(key)}>{label}</button>
        ))}
      </div>
      </div>
      <div role='tabpanel' id={id + '-panel'} aria-labelledby={id + '-' + language} key={language}>
        {language === 'general' ? (
          <div className='runtime-workspace code-general'>
            <RuntimeSection title='代码编辑'>
              <label className='pref-row'>
                <span>默认缩进空格数</span>
                <NumberField label='代码块默认缩进空格数' value={indent} min={1} max={16}
                  change={value => { const width = Math.round(value); setIndent(width); setCodeIndentWidth(width); }} />
              </label>
            </RuntimeSection>
            <CodeFormattingPreferences />
          </div>
        ) : language === 'python' ? <PythonPreferences /> : <RuntimePreferences language={language} />}
      </div>
    </div>
  );
});
