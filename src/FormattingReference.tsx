import { useState } from 'react';
import data from './formatting-reference.json';
import './formattingReference.css';
const languageNames: Record<string, string> = {
  global: '共同选项',
  typescript: 'JavaScript / TypeScript',
  ruff: 'Python',
  clangFormat: 'C / C++',
  sql: 'SQL',
  roslyn: 'C#',
  java: 'Java',
  stylua: 'Lua',
  ruby: 'Ruby',
  bash: 'Bash',
};
const typeNames: Record<string, string> = {
  boolean: '布尔值',
  number: '数值',
  integer: '整数',
  string: '字符串',
  array: '数组',
  object: '对象',
};
export function FormattingReference() {
  const [key, setKey] = useState<keyof typeof data>('typescript'),
    [search, setSearch] = useState(''),
    [limit, setLimit] = useState(40);
  const item = data[key],
    rows = item.rows.filter(r => (r.name + ' ' + r.description).toLowerCase().includes(search.toLowerCase()));
  return (
    <section className='formatting-reference'>
      <div className='formatting-reference-controls'>
        <select
          aria-label='格式化插件参考'
          value={key}
          onChange={e => {
            setKey(e.target.value as keyof typeof data);
            setLimit(40);
          }}
        >
          {Object.entries(data).map(([key, value]) => (
            <option key={key} value={key}>{languageNames[key]} ({value.configKey})</option>
          ))}
        </select>
        <input
          aria-label='筛选格式化参数'
          placeholder='筛选参数'
          value={search}
          onChange={e => {
            setSearch(e.target.value);
            setLimit(40);
          }}
        />
      </div>
      <details className='formatting-tools'>
        <summary>语言与格式化工具</summary>
        <table>
          <thead>
            <tr>
              <th>语言</th>
              <th>工具</th>
              <th>配置对象</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(data).filter(([name]) => name !== 'global').map(([name, value]) => (
              <tr key={name}>
                <td>{languageNames[name]}</td>
                <td>{value.name} {value.version}</td>
                <td>
                  <code>{value.configKey}</code>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
      <p className='muted-note'>
        {item.name} {item.version}
        {item.url && <a href={item.url} target='_blank' rel='noreferrer'>参考文档</a>}
      </p>
      {'note' in item && <p className='muted-note'>{item.note}</p>}
      {!!rows.length && (
        <table>
          <thead>
            <tr>
              <th>参数</th>
              <th>类型 / 可选值</th>
              <th>含义</th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, limit).map(r => (
              <tr key={r.name}>
                <td>
                  <code>{r.name}</code>
                  {'default' in r && r.default !== undefined && (
                    <small>插件默认 {JSON.stringify(r.default)}</small>
                  )}
                </td>
                <td>
                  <span>
                    {r.type.replace(/boolean|number|integer|string|array|object/g, type => typeNames[type])}
                  </span>
                  {r.values.length > 160
                    ? (
                      <details>
                        <summary>查看可选值</summary>
                        <small>{r.values}</small>
                      </details>
                    )
                    : <small>{r.values}</small>}
                </td>
                <td>{r.description}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {rows.length > limit && (
        <button className='text-button' onClick={() => setLimit(v => v + 40)}>
          显示更多（{limit} / {rows.length}）
        </button>
      )}
      {key === 'clangFormat' && (
        <p className='muted-note'>
          子选项按 JSON 对象嵌套填写；[] 表示数组元素，不作为键名。TypeScript
          中带点号的键则按完整键名填写。不支持 file 和 InheritParentConfig。
        </p>
      )}
    </section>
  );
}
