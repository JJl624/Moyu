import type { Node } from '@milkdown/kit/prose/model';
import { MarkdownSource, type SourceSpan } from './markdownSource';

export interface DocumentCodec {
  parse(source: string): Node;
  serialize(document: Node): string;
  spans(source: string): SourceSpan[];
}

/** Per-document source ownership. Reading never acknowledges or saves an edit. */
export class DocumentSession {
  private snapshot: MarkdownSource;
  private acknowledgedDocument: Node;
  private encoded?: { source: string; document: Node };
  private savedSource?: string;

  constructor(source: string, document: Node, private codec: DocumentCodec, savedSource?: string) {
    this.snapshot = this.createSnapshot(source, document);
    this.acknowledgedDocument = document;
    this.savedSource = savedSource;
  }

  private createSnapshot(source: string, document: Node) {
    return new MarkdownSource(source, document, this.codec.parse, this.codec.serialize, this.codec.spans);
  }

  private advanceSavedSource(source: string | undefined) {
    if (source === undefined || source === this.savedSource) return;
    const document = this.encoded?.source === source ? this.encoded.document : this.codec.parse(source);
    this.snapshot = this.createSnapshot(source, document);
    this.savedSource = source;
    this.encoded = undefined;
  }

  read(document: Node, savedSource?: string): string {
    this.advanceSavedSource(savedSource);
    if (this.encoded?.document.eq(document)) return this.encoded.source;
    const source = this.snapshot.write(document);
    this.encoded = { source, document };
    return source;
  }

  publish(document: Node, savedSource: string | undefined, currentSource: string, notify: (source: string) => void) {
    if (this.acknowledgedDocument.eq(document)) return;
    const source = this.read(document, savedSource);
    if (source !== currentSource) notify(source);
    // A failed serializer or receiver leaves the edit pending for the next flush.
    this.acknowledgedDocument = document;
  }
}
