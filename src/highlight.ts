import {
  LanguageDescription,
  LanguageSupport,
  StreamLanguage,
  syntaxHighlighting,
} from '@codemirror/language';
import { languages as standardLanguages } from '@codemirror/language-data';
import { classHighlighter, highlightTree } from '@lezer/highlight';
export const languages = [
  ...standardLanguages,
  LanguageDescription.of({
    name: '纯文本',
    alias: ['text', 'plain', 'plaintext', 'txt'],
    extensions: ['txt'],
    load: async () =>
      new LanguageSupport(StreamLanguage.define({
        token(stream) {
          stream.skipToEnd();
          return null;
        },
      })),
  }),
  LanguageDescription.of({
    name: 'Mermaid',
    alias: ['mermaid'],
    extensions: ['mmd'],
    load: async () =>
      new LanguageSupport(StreamLanguage.define({
        token(stream) {
          if (stream.match(/^%%.*/)) return 'comment';
          if (
            stream.match(
              /^(?:flowchart|graph|sequenceDiagram|classDiagram|stateDiagram(?:-v2)?|erDiagram|gantt|pie|mindmap|timeline|subgraph|end|direction|participant|actor|title|section)\b/,
            )
          ) return 'keyword';
          if (stream.match(/^"[^"]*"/)) return 'string';
          if (stream.match(/^(?:-->|---|==>|->>|-->>|:::|\|)/)) return 'operator';
          stream.next();
          return null;
        },
      })),
  }),
  LanguageDescription.of({
    name: 'Tabs',
    alias: ['tabs'],
    load: async () =>
      new LanguageSupport(StreamLanguage.define({
        token(stream) {
          if (stream.sol() && stream.match(/^:::\S+.*/)) return 'meta';
          stream.skipToEnd();
          return null;
        },
      })),
  }),
];
export const codeHighlight = syntaxHighlighting(classHighlighter);
export const codeLanguage = (language: string) => {
  const value = language.toLowerCase();
  return languages.find(l =>
    l.name.toLowerCase() === value || l.alias.some(alias => alias.toLowerCase() === value)
  ) ?? languages.find(l => l.extensions.some(extension => extension.toLowerCase() === value));
};
export async function highlightCodeElement(element: HTMLElement, code: string, language: string) {
  const support = await codeLanguage(language)?.load();
  const fragment = document.createDocumentFragment();
  let position = 0;
  if (support) {
    highlightTree(support.language.parser.parse(code), classHighlighter, (from, to, css) => {
      if (from > position) {
        fragment.append(document.createTextNode(code.slice(position, from)));
      }
      const span = document.createElement('span');
      span.className = css;
      span.textContent = code.slice(from, to);
      fragment.append(span);
      position = to;
    });
  }
  if (position < code.length) fragment.append(document.createTextNode(code.slice(position)));
  element.replaceChildren(fragment);
}
type Element = {
  type: string;
  tagName?: string;
  properties?: Record<string, unknown>;
  value?: string;
  children?: Element[];
};
export function highlightReading() {
  return async (tree: Element) => {
    const jobs: Promise<void>[] = [];
    const walk = (n: Element) => {
      if (n.tagName === 'code' && n.children?.every(c => c.type === 'text')) {
        const classes = n.properties?.className as string[] | undefined,
          language = classes?.find(c => c.startsWith('language-'))?.slice(9);
        const description = codeLanguage(language || '');
        if (description) {
          jobs.push((async () => {
            const support = await description.load(),
              text = n.children!.map(c => c.value || '').join(''),
              children: Element[] = [];
            let position = 0;
            highlightTree(
              support.language.parser.parse(text),
              classHighlighter,
              (from, to, css) => {
                if (from > position) {
                  children.push({ type: 'text', value: text.slice(position, from) });
                }
                children.push({
                  type: 'element',
                  tagName: 'span',
                  properties: { className: css.split(' ') },
                  children: [{ type: 'text', value: text.slice(from, to) }],
                });
                position = to;
              },
            );
            if (position < text.length) {
              children.push({ type: 'text', value: text.slice(position) });
            }
            n.children = children;
          })());
        }
      }
      n.children?.forEach(walk);
    };
    walk(tree);
    await Promise.all(jobs);
  };
}
