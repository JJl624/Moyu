import type { Node } from '@milkdown/kit/prose/model';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import remarkParse from 'remark-parse';
import { unified } from 'unified';
import remarkHighlight from '../../shared/remark-highlight.mjs';
import remarkFoldingQuotes from '../../shared/remark-folding-quotes.mjs';
import { readableSource } from '../../shared/link-destinations.mjs';
import { attachmentFromSource, isAttachmentLink } from '../attachmentLinks';
import { inlineRaw, inlineSourceRequired } from '../inlineSyntax';
type Ast = {
  type: string;
  depth?: number;
  value?: string;
  url?: string;
  position?: { start: { offset: number }; end: { offset: number } };
  children?: Ast[];
};
// Pair Markdown text blocks with ProseMirror text blocks, retaining inline syntax
// offsets. This maps the same text/caret through the two different document models.
const mappings = new WeakMap<
  Node,
  { markdown: string; blocks: { start: number; size: number; offsets: number[] }[] }
>();
const parser = unified().use(remarkParse).use(remarkGfm).use(remarkMath).use(remarkHighlight).use(remarkFoldingQuotes);
function pairs(markdown: string, doc: Node) {
  const cached = mappings.get(doc);
  if (cached?.markdown === markdown) return cached.blocks;
  let sources = false, legacyMath = false;
  doc.descendants(node => {
    if (node.type.name === 'resource_link') sources = true;
    if (node.type.name === 'math_inline') legacyMath = true;
  });
  const blocks: { text: string; offsets: number[] }[] = [];
  const walk = (n: Ast) => {
    if (['paragraph', 'heading', 'tableCell', 'code', 'math'].includes(n.type) || n.type === 'html' && /^<!--/.test(n.value || '')) {
      let text = '', offsets: number[] = [], end = 0;
      const add = (child: Ast) => {
        if (
          sources && inlineSourceRequired(child,inlineRaw(child,markdown)) && !(legacyMath && child.type === 'inlineMath')
          && child.position
        ) {
          const raw = inlineRaw(child, markdown), source = readableSource(child, markdown);
          offsets.push(...source.offsets.slice(0, raw.length));
          text += raw;
          end = child.position.end.offset;
          return;
        }
        if (isAttachmentLink(child) && child.position) {
          const start = child.position.start.offset,
            stop = child.position.end.offset,
            raw = markdown.slice(start, stop),
            display = attachmentFromSource(child, markdown);
          let cursor = 0;
          for (let i = 0; i < display.length; i++) {
            const char = display[i], found = raw.indexOf(char, cursor);
            cursor = found < 0 ? cursor : found;
            offsets.push(Math.min(stop, start + cursor));
            cursor++;
          }
          text += display;
          end = stop;
          return;
        }
        if (child.value !== undefined && child.position) {
          const raw = markdown.slice(child.position.start.offset, child.position.end.offset);
          let cursor = ['code','math'].includes(n.type)
            ? raw.indexOf('\n') + 1
            : child.type === 'inlineCode'
            ? raw.match(/^`+/)?.[0].length || 0
            : child.type === 'inlineMath'
            ? 1
            : 0;
          for (let i = 0; i < child.value.length; i++) {
            if(child.value[i]==='\r'&&child.value[i+1]==='\n')continue;
            const char = child.value[i], found = raw.indexOf(char, cursor);
            cursor = found < 0 ? cursor : found;
            offsets.push(child.position.start.offset + cursor);
            cursor++;
            text += char;
          }
          end = child.position.start.offset + cursor;
          if (child.type === 'inlineMath') end++;
        } else child.children?.forEach(add);
      };
      if (n.type === 'heading' && doc.type.schema.nodes.heading?.spec.attrs?.sourceHeading) {
        const prefix = '#'.repeat(n.depth || 1) + ' ', start = n.position?.start.offset || 0;
        text = prefix;
        for (let i = 0; i < prefix.length; i++) offsets.push(start + i);
      }
      add(n);
      offsets.push(end);
      blocks.push({ text, offsets });
      return;
    }
    n.children?.forEach(walk);
  };
  walk(parser.runSync(parser.parse(markdown), { value: markdown }) as Ast);
  const result: { start: number; size: number; offsets: number[] }[] = [];
  let next = 0;
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return;
    let text='';node.forEach(child=>{text+=child.type.name==='hardbreak'?'\n':child.textContent;});
    let index = blocks.findIndex((b, i) => i >= next && b.text === text);
    if (index < 0) index = blocks.findIndex((b, i) => i >= next && b.text.trim() === text.trim());
    if (index >= 0) {
      const source = blocks[index].offsets, mapped: number[] = [];
      let cursor = 0;
      // Inline text containers have two ProseMirror boundary positions. Derive
      // those from the actual rich node, including incomplete attachment links
      // that the Markdown parser currently sees as plain text.
      node.forEach(child => {
        if (child.isInline && !child.isLeaf) {
          const first = source[cursor] ?? source.at(-1) ?? 0;
          mapped.push(child.type.name === 'math_inline' ? Math.max(0, first - 1) : first);
          for (let i = 0; i < child.textContent.length; i++) mapped.push(source[cursor++] ?? first);
          mapped.push((source[cursor - 1] ?? first) + 1);
        } else if (child.isText) {
          for (let i = 0; i < child.textContent.length; i++) {
            mapped.push(source[cursor++] ?? source.at(-1) ?? 0);
          }
        } else mapped.push(source[cursor++] ?? source.at(-1) ?? 0);
      });
      mapped.push(source[cursor] ?? source.at(-1) ?? 0);
      result.push({ start: pos + 1, size: node.content.size, offsets: mapped });
      next = index + 1;
    }
    return false;
  });
  mappings.set(doc, { markdown, blocks: result });
  return result;
}
export function toMarkdownSelection(markdown: string, doc: Node, pos: number) {
  const list = pairs(markdown, doc),
    block = list.find(b => pos >= b.start && pos <= b.start + b.size)
      || list.reduce<typeof list[number] | undefined>(
        (best, b) => !best || Math.abs(pos - b.start) < Math.abs(pos - best.start) ? b : best,
        undefined,
      );
  return block?.offsets[Math.min(Math.max(0, pos - block.start), block.offsets.length - 1)] ?? 0;
}
export function fromMarkdownSelection(markdown: string, doc: Node, offset: number) {
  let nearest = { distance: Infinity, pos: 1 };
  for (const block of pairs(markdown, doc)) {
    block.offsets.forEach((value, index) => {
      const distance = Math.abs(value - offset);
      if (distance < nearest.distance) {
        nearest = { distance, pos: block.start + Math.min(index, block.size) };
      }
    });
  }
  return Math.min(doc.content.size, nearest.pos);
}
