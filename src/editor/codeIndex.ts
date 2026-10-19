import type { Node } from '@milkdown/kit/prose/model';
import type { EditorView } from '@milkdown/kit/prose/view';
import { codeId } from '../../shared/code-documents.mjs';
import { canonicalLanguage, codeBlocks } from '../codeBlocks';
import type { CodeContext } from '../editorTypes';

type SourceBlocks = ReturnType<typeof codeBlocks>;
interface Index {
  doc: Node;
  markdown: string;
  sources: SourceBlocks;
  blocks: Map<globalThis.Node, CodeContext>;
}
const indices = new WeakMap<EditorView, Index>();
const signature = (language: string, code: string) => JSON.stringify([canonicalLanguage(language), code]);

// One source parse and DOM index per document revision, shared by run controls
// and context actions. Selection-only transactions reuse the same index.
export function codeContextAt(view: EditorView, markdown: string, target: HTMLElement) {
  const dom = target.closest('.milkdown-code-block');
  if (!dom) return null;
  let index = indices.get(view);
  if (!index || index.doc !== view.state.doc || index.markdown !== markdown) {
    const sources = index?.markdown === markdown ? index.sources : codeBlocks(markdown);
    const byId = new Map<string, SourceBlocks[number] | undefined>();
    for (const block of sources) {
      if (block.id) byId.set(block.id, byId.has(block.id) ? undefined : block);
    }
    const bySource = new Map<string, SourceBlocks>();
    for (const block of sources) {
      const key = signature(block.language, block.code), group = bySource.get(key) || [];
      group.push(block);
      bySource.set(key, group);
    }
    const used = new Set<SourceBlocks[number]>(), blocks = new Map<globalThis.Node, CodeContext>();
    view.state.doc.descendants((node, pos) => {
      if (node.type.name !== 'code_block') return;
      const dom = view.nodeDOM(pos);
      if (!dom) return false;
      const language = node.attrs.language || '', code = node.textContent, meta = node.attrs.meta || '';
      const id = codeId(meta), exact = id && byId.get(id);
      const source = exact && !used.has(exact) ? exact
        : bySource.get(signature(language, code))?.find(b => !used.has(b));
      if (source) used.add(source);
      blocks.set(dom, { language, code, meta, id, start: source?.start });
      return false;
    });
    index = { doc: view.state.doc, markdown, sources, blocks };
    indices.set(view, index);
  }
  const result = index.blocks.get(dom);
  return result ? { ...result } : null;
}
