export interface ParsedBlock {
  language: string;
  code: string;
  meta: string;
  id: string;
  start: number;
  end: number;
  headerEnd: number;
  fence: string;
}
export function parseBlocks(content: string): ParsedBlock[];
export function codeInfo(
  node: { lang?: unknown; meta?: unknown },
): { language: string; meta: string };
export function codeId(meta: string): string;
export function attribute(meta: string, key: string): string;
export function withAttribute(meta: string, key: string, value: string): string;
export function groups(meta: string): { from: number; to: number }[];
export function normalizeIds(
  content: string,
  floor?: number,
): { content: string; next: number; exhausted?: boolean; edits: { from: number; to: number; insert: string }[] };
