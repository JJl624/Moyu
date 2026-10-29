import type { Node } from '@milkdown/kit/prose/model';
import { assertBlockRoundTrip } from './documentContract';

export interface SourceSpan { from: number; to: number }
interface Block extends SourceSpan { node: Node }
interface Output { body: string; index?: number }
type Parse = (source: string) => Node;
type Serialize = (document: Node) => string;

// Ignore only empty top-level paragraphs: Markdown represents them as gaps,
// while the live editor needs actual paragraphs to hold the caret.
function sameDocument(a: Node, b: Node) {
  const content = (doc: Node) => {
    const nodes: Node[] = [];
    doc.forEach(node => { if (node.type.name !== 'paragraph' || node.content.size) nodes.push(node); });
    return doc.type.create(doc.attrs, nodes);
  };
  return a.eq(b) || content(a).eq(content(b));
}

function textChange(before: Node, after: Node): { before: string; after: string } | null {
  if (!before.sameMarkup(after) || before.childCount !== after.childCount) return null;
  if (before.isText) return before.text === after.text ? null : { before: before.text!, after: after.text! };
  let result: ReturnType<typeof textChange> = null;
  for (let i = 0; i < before.childCount; i++) {
    const old = before.child(i), next = after.child(i);
    if (old.eq(next)) continue;
    const change = textChange(old, next);
    if (!change || result) return null;
    result = change;
  }
  return result;
}

export class MarkdownSource {
  private blocks: Block[] | null = null;
  private indexed = false;
  private keys = new WeakMap<Node, string>();
  private bodies = new WeakMap<Node, string>();
  private comparableNodes = new WeakMap<Node, Node>();
  constructor(
    readonly source: string,
    readonly document: Node,
    private parse: Parse,
    private serialize: Serialize,
    private spans: (source: string) => SourceSpan[],
  ) {}
  private comparable(node: Node): Node {
    const cached = this.comparableNodes.get(node);
    if (cached) return cached;
    const children: Node[] = [];
    let changed = false;
    node.forEach(child => { const next = this.comparable(child); children.push(next); changed ||= next !== child; });
    // Heading IDs are generated DOM anchors, not Markdown code-block IDs.
    const heading = node.type.name === 'heading' && node.attrs.id;
    const value = changed || heading ? node.type.create(heading ? { ...node.attrs, id: '' } : node.attrs, children, node.marks) : node;
    this.comparableNodes.set(node, value);
    return value;
  }
  private key(node: Node) {
    let key = this.keys.get(node);
    if (key === undefined) {
      key = node.type.name + ':' + node.nodeSize + ':' + node.textContent;
      this.keys.set(node, key);
    }
    return key;
  }
  private index() {
    if (this.indexed) return this.blocks;
    this.indexed = true;
    const spans = this.spans(this.source);
    if (spans.length !== this.document.childCount) return null;
    let end = 0;
    if (spans.some(span => {
      const invalid = span.from < end || span.to < span.from || span.to > this.source.length;
      end = span.to;
      return invalid;
    })) return null;
    return this.blocks = spans.map((span, i) => ({ ...span, node: this.document.child(i) }));
  }
  private body(node: Node) {
    let value = this.bodies.get(node);
    if (value === undefined) {
      value = this.serialize(this.document.type.create(this.document.attrs, node)).replace(/\n$/, '');
      if (this.source.includes('\r\n')) value = value.replace(/\r?\n/g, '\r\n');
      this.bodies.set(node, value);
    }
    return value;
  }
  private patch(block: Block, node: Node) {
    const change = textChange(this.comparable(block.node), this.comparable(node));
    if (!change || !change.before) return null;
    const raw = this.source.slice(block.from, block.to);
    const variants = [change];
    if (node.type.name === 'heading' && /^#{1,6} /.test(change.before) && /^#{1,6} /.test(change.after)) {
      variants.push({ before: change.before.replace(/^#{1,6} /, ''), after: change.after.replace(/^#{1,6} /, '') });
    }
    for (const { before, after } of variants) {
      if (!before) continue;
      let at = -1;
      for (let attempt = 0; attempt < 8; attempt++) {
        at = raw.indexOf(before, at + 1);
        if (at < 0) break;
        const candidate = raw.slice(0, at) + after + raw.slice(at + before.length);
        if (this.matches(candidate, this.document.type.create(this.document.attrs, node))) return candidate;
      }
    }
    return null;
  }
  private matches(source: string, node: Node, gaps = false) {
    try {
      const parsed = this.comparable(this.parse(source)), expected = this.comparable(node);
      return gaps ? sameDocument(parsed, expected) : parsed.eq(expected);
    } catch { return false; }
  }
  private serializeChecked(document: Node) {
    const source = this.serialize(document);
    assertBlockRoundTrip(document, this.parse(source));
    return source;
  }
  write(current: Node) {
    if (this.comparable(current).eq(this.comparable(this.document))) return this.source;
    const blocks = this.index();
    if (!blocks?.length) return this.serializeChecked(current);
    const groups = new Map<string, number[]>();
    blocks.forEach((block, i) => {
      const key = this.key(block.node), group = groups.get(key) || [];
      group.push(i); groups.set(key, group);
    });
    const nodes: Node[] = []; current.forEach(node => nodes.push(node));
    const anchors: { old: number; next: number }[] = [{ old: -1, next: -1 }];
    let last = -1;
    nodes.forEach((node, next) => {
      const old = groups.get(this.key(node))?.find(i => i > last && this.comparable(blocks[i].node).eq(this.comparable(node)));
      if (old !== undefined) { anchors.push({ old, next }); last = old; }
    });
    anchors.push({ old: blocks.length, next: nodes.length });
    const output: Output[] = [];
    for (let i = 1; i < anchors.length; i++) {
      const previous = anchors[i - 1], anchor = anchors[i];
      for (let n = previous.next + 1; n < anchor.next; n++) {
        const old = anchor.old - previous.old === 2 && anchor.next - previous.next === 2 ? previous.old + 1 : undefined;
        output.push({ body: old === undefined ? this.body(nodes[n]) : this.patch(blocks[old], nodes[n]) ?? this.body(nodes[n]), index: old });
      }
      if (anchor.old < blocks.length) output.push({ body: this.source.slice(blocks[anchor.old].from, blocks[anchor.old].to), index: anchor.old });
    }
    const newline = this.source.includes('\r\n') ? '\r\n' : '\n';
    let result = this.source.slice(0, blocks[0].from);
    output.forEach((block, i) => {
      const previous = output[i - 1];
      if (i) result += previous.index !== undefined && block.index === previous.index + 1
        ? this.source.slice(blocks[previous.index].to, blocks[block.index].from)
        : newline + newline;
      result += block.body;
    });
    result += this.source.slice(blocks.at(-1)!.to);
    // A splice is accepted only if it still parses as the live document.
    return this.matches(result, current, true) ? result : this.serializeChecked(current);
  }
}
