import { useEffect, useRef } from 'react';
import { highlightCodeElement } from './highlight';

export const formattingExamples: Record<string, { name: string; code: string }> = {
  javascript: {
    name: 'JavaScript',
    code:
      'const user={name:"Moyu",tags:["notes","code"]};\nfunction greet(name){if(name){return "Hello, "+name;}return "Hello";}\nconsole.log(greet(user.name));',
  },
  typescript: {
    name: 'TypeScript',
    code:
      'interface Note{title:string;tags:string[];}\nconst notes:Note[]=[{title:"Moyu",tags:["markdown","code"]}];\nfunction titles(items:Note[]):string[]{return items.map(item=>item.title);}',
  },
  python: {
    name: 'Python',
    code:
      'def summarize(values):\n    total=sum(values)\n    return {"total":total,"average":total/len(values)}\n\nprint(summarize([1,2,3,4]))',
  },
  c: {
    name: 'C',
    code:
      '#include <stdio.h>\nint main(void){int values[]={1,2,3};for(int i=0;i<3;i++){printf("%d\\n",values[i]);}return 0;}',
  },
  cpp: {
    name: 'C++',
    code:
      '#include <iostream>\n#include <vector>\nint main(){std::vector<int> values{1,2,3};for(const auto value:values){std::cout<<value<<"\\n";}return 0;}',
  },
  sql: {
    name: 'SQL',
    code:
      'select n.title,count(t.id) as tag_count from notes n left join tags t on t.note_id=n.id where n.archived=0 group by n.id,n.title order by n.title;',
  },
  csharp:{name:"C#",code:'using System; class Program{static void Main(){var values=new[]{1,2,3};foreach(var value in values){Console.WriteLine(value);}}}'},
  java:{name:"Java",code:'public class Main{public static void main(String[] args){int[] values={1,2,3};for(int value:values){System.out.println(value);}}}'},
  lua: {
    name: 'Lua',
    code:
      'local values={1,2,3}\nlocal function total(items) local sum=0 for _,value in ipairs(items) do sum=sum+value end return sum end\nprint(total(values))',
  },
};

export function FormattingPreview({ language, code, formatted, busy, onLanguage, onPreview }: {
  language: string;
  code: string;
  formatted: boolean;
  busy: boolean;
  onLanguage(value: string): void;
  onPreview(): void;
}) {
  const element = useRef<HTMLElement>(null);
  useEffect(() => {
    let current = true;
    // Highlight off-screen, then commit only the latest language and text.
    const detached = document.createElement('code');
    void highlightCodeElement(detached, code, language).then(() => {
      if (current) element.current?.replaceChildren(...detached.childNodes);
    }).catch(() => {});
    return () => {
      current = false;
    };
  }, [code, language]);
  return (
    <div className='format-preview'>
      <div className='format-preview-heading'>
        <span>示例预览</span>
        <select
          aria-label='预览语言'
          value={language}
          disabled={busy}
          onChange={event => onLanguage(event.target.value)}
        >
          {Object.entries(formattingExamples).map(([value, example]) => (
            <option value={value} key={value}>{example.name}</option>
          ))}
        </select>
        <button className='text-button' aria-label='更新格式化预览' disabled={busy} onClick={onPreview}>
          {busy ? '处理中…' : '预览'}
        </button>
      </div>
      <pre
        role='button'
        tabIndex={0}
        aria-label='格式化示例代码'
        aria-disabled={busy}
        data-formatted={formatted}
        title='点击格式化预览'
        onClick={() => {
          if (!busy && window.getSelection()?.isCollapsed !== false) onPreview();
        }}
        onKeyDown={event => {
          if (!busy && ['Enter', ' '].includes(event.key)) {
            event.preventDefault();
            onPreview();
          }
        }}
      >
      <code ref={element} className={'language-'+language}>{code}</code>
      </pre>
    </div>
  );
}
