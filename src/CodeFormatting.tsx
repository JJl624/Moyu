import { useRef, useState } from 'react';
import { api } from './bridge';
import { formattingExamples, FormattingPreview } from './FormattingPreview';
import { settingsStore } from './settingsStore';
import { usePreferenceDraft } from './preferenceDraft';
import {FormattingReference} from './FormattingReference';

type OptionValue = string | number | boolean | null | OptionValue[] | {
  [key: string]: OptionValue;
};
type Options = Record<string, OptionValue>;
interface Settings {
  version: 2;
  global: Options;
  typescript: Options;
  ruff: Options;
  clangFormat: Options;
  sql: Options;
  stylua: Options;
  roslyn: Options;
  java: Options;
}
const defaults: Settings = {
  version: 2,
  global: { lineWidth: 120, indentWidth: 2, useTabs: false, newLineKind: 'lf' },
  typescript: {
    quoteStyle: 'alwaysDouble',
    semiColons: 'prefer',
    'arguments.trailingCommas': 'onlyMultiLine',
    'parameters.trailingCommas': 'onlyMultiLine',
    'arrayExpression.trailingCommas': 'onlyMultiLine',
    'objectExpression.trailingCommas': 'onlyMultiLine',
    'module.sortImportDeclarations': 'maintain',
    'module.sortExportDeclarations': 'maintain',
    'importDeclaration.sortNamedImports': 'maintain',
    'exportDeclaration.sortNamedExports': 'maintain',
  },
  ruff: {
    lineLength: 88,
    indentWidth: 4,
    indentStyle: 'space',
    lineEnding: 'lf',
    quoteStyle: 'double',
    skipMagicTrailingComma: false,
  },
  clangFormat: { BasedOnStyle: 'LLVM' },
  sql: {},
  stylua: { verify: true },
  roslyn:{},
  java:{},
};
const copy = () => structuredClone(defaults);
export function formattingSettings(): Settings {
  try {
    const saved = JSON.parse(settingsStore.getItem('moyu-code-formatting') || '{}');
    if (saved.version === 2) {
      return {
        version: 2,
        global: { ...defaults.global, ...saved.global },
        typescript: { ...defaults.typescript, ...saved.typescript },
        ruff: { ...defaults.ruff, ...saved.ruff },
        clangFormat: { ...defaults.clangFormat, ...saved.clangFormat },
        sql: { ...defaults.sql, ...saved.sql },
        stylua: { ...defaults.stylua, ...saved.stylua },
        roslyn:{...saved.roslyn},
        java:{...saved.java},
      };
    }
    const next = copy();
    if (saved.jsWidth !== undefined) {
      Object.assign(next.global, {
        lineWidth: saved.jsWidth,
        indentWidth: saved.jsIndent,
        useTabs: saved.jsTabs,
      });
      Object.assign(next.typescript, {
        quoteStyle: saved.jsSingle ? 'alwaysSingle' : 'alwaysDouble',
        semiColons: saved.jsSemi ? 'always' : 'asi',
      });
      for (const key of ['arguments', 'parameters', 'arrayExpression', 'objectExpression']) {
        next.typescript[key + '.trailingCommas'] = saved.jsTrailing === 'none'
            || saved.jsTrailing === 'es5' && ['arguments', 'parameters'].includes(key)
          ? 'never'
          : 'onlyMultiLine';
      }
      Object.assign(next.ruff, {
        lineLength: saved.pythonWidth,
        indentWidth: saved.pythonIndent,
        quoteStyle: saved.pythonSingle ? 'single' : 'double',
      });
    }
    return next;
  } catch {
    return copy();
  }
}
function parseFormattingSettings(draft: string): Settings {
  const parsed = JSON.parse(draft);
  if (
    !parsed || typeof parsed !== 'object' || Array.isArray(parsed)
    || Object.keys(parsed).some(k =>
      !['lineWidth', 'indentWidth', 'useTabs', 'newLineKind', 'typescript', 'ruff', 'clangFormat', 'sql', 'stylua', 'roslyn', 'java']
        .includes(k)
    )
  ) throw Error('顶层为共同选项，以及 typescript、ruff、clangFormat、sql、stylua、roslyn、java 配置。');
  for (const key of ['typescript', 'ruff', 'clangFormat', 'sql', 'stylua', 'roslyn', 'java']) {
    if (
      parsed[key] !== undefined
      && (!parsed[key] || typeof parsed[key] !== 'object' || Array.isArray(parsed[key]))
    ) throw Error(key + ' 必须是配置对象。');
  }
  return {
    version: 2,
    global: {
      ...defaults.global,
      ...Object.fromEntries(
        Object.entries(parsed).filter(([key]) => !['typescript', 'ruff', 'clangFormat', 'sql', 'stylua', 'roslyn', 'java'].includes(key)),
      ) as Options,
    },
    typescript: { ...defaults.typescript, ...parsed.typescript },
    ruff: { ...defaults.ruff, ...parsed.ruff },
    clangFormat: { ...defaults.clangFormat, ...parsed.clangFormat },
    sql: { ...defaults.sql, ...parsed.sql },
    stylua: { ...defaults.stylua, ...parsed.stylua },
    roslyn:{...parsed.roslyn},
    java:{...parsed.java},
  };
}
export function CodeFormattingPreferences() {
  const serialize = (value: Settings) =>
    JSON.stringify(
      {
        ...value.global,
        typescript: value.typescript,
        ruff: value.ruff,
        clangFormat: value.clangFormat,
        sql: value.sql,
        stylua: value.stylua,
        roslyn:value.roslyn,
        java:value.java,
      },
      null,
      2,
    );
  const preferences = usePreferenceDraft('formatting', serialize(formattingSettings()), async text => {
    const next = parseFormattingSettings(text);
    for (const language of ['ts','python','cpp','sql','lua']) await api.feature('code.format', {language,code:'',config:next.global,pluginConfig:language==='ts'?next.typescript:language==='python'?next.ruff:language==='cpp'?next.clangFormat:language==='sql'?next.sql:next.stylua});
    for(const language of ['csharp','java']){
      const state=await api.feature<{selected:string}>('runtime.state',{language});
      if(state.selected)await api.feature('code.format',{language,code:'',config:next.global,pluginConfig:language==='csharp'?next.roslyn:next.java});
    }
    settingsStore.setItem('moyu-code-formatting', JSON.stringify(next));await settingsStore.flush();
  },()=>serialize(copy()));
  const draft=preferences.value,setDraft=preferences.set,busy=preferences.saving;
  const [error,setError]=useState('');
  const [tab,setTab]=useState<'config'|'reference'>('config');
  const [language, setLanguage] = useState('javascript'),
    [preview, setPreview] = useState<string | null>(null),
    [previewBusy, setPreviewBusy] = useState(false);
  const revision = useRef(0);
  const resetPreview = () => {
    revision.current++;
    setPreview(null);
    setPreviewBusy(false);
  };
  const showPreview = async () => {
    const ticket = ++revision.current;
    setError('');
    setPreviewBusy(true);
    try {
      await preferences.commit();
      const next = parseFormattingSettings(draft);
      const result = await formatWithSettings(language, formattingExamples[language].code, next);
      if (ticket === revision.current) setPreview(result);
    } catch (e) {
      if (ticket === revision.current) setError((e as Error).message);
    } finally {
      if (ticket === revision.current) setPreviewBusy(false);
    }
  };
  return (
    <section className='pref-section code-formatting' onBlur={preferences.events.onBlur}>
      <div className='formatting-tabs'><h3>代码格式化</h3><button role='tab' aria-selected={tab==='config'} onClick={()=>setTab('config')}>配置</button><button role='tab' aria-selected={tab==='reference'} onClick={()=>setTab('reference')}>参考</button></div>
      {tab==='reference'?<FormattingReference/>:<>
      <textarea
        className='dprint-json'
        aria-label='dprint 配置 JSON'
        rows={18}
        spellCheck={false}
        value={draft}
        onChange={e => {
          setDraft(e.target.value);
          resetPreview();
          setError('');

        }}
      />
      {busy && <small role='status'>正在应用…</small>}
      <FormattingPreview
        language={language}
        code={preview ?? formattingExamples[language].code}
        formatted={preview !== null}
        busy={previewBusy}
        onPreview={() => void showPreview()}
        onLanguage={value => {
          setLanguage(value);
          resetPreview();
          setError('');
        }}
      />
      {(error || preferences.error) && <p role='alert' className='feature-error'>{error || preferences.error}</p>}
      </>}
    </section>
  );
}
async function formatWithSettings(language: string, code: string, value: Settings) {
  const python = /^(py|python)$/i.test(language), clang = /^(c|cpp|c\+\+|cc|cxx)$/i.test(language);
  return api.feature<string>('code.format', {
    language: language.toLowerCase(),
    code,
    config: value.global,
    pluginConfig:/^(cs|csharp|c#)$/i.test(language)?value.roslyn:/^java$/i.test(language)?value.java:python
      ? value.ruff
      : clang
      ? value.clangFormat
      : /^(sql|sqlite)$/i.test(language)
      ? value.sql
      : /^lua$/i.test(language)
      ? value.stylua
      : value.typescript,
  });
}

export async function formatCode(language: string, code: string) {
  return formatWithSettings(language, code, formattingSettings());
}
