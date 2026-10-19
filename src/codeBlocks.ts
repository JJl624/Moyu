import {parseBlocks} from '../shared/code-documents.mjs';
export interface CodeBlock {
  language: string;
  code: string;
  start: number;
  end: number;
  occurrence: number;
  index: number;
  id: string;
  meta: string;
}
export interface CodeIdentity {
  language: string;
  code: string;
  occurrence: number;
  index?: number;
  id?: string;
  meta?: string;
}
import { canonicalLanguage } from '../shared/code-languages.mjs';
export { canonicalLanguage, formattable, runnable } from '../shared/code-languages.mjs';
export const codeKey = (block: CodeIdentity) =>
  JSON.stringify([block.language.toLowerCase(), block.code, block.id||block.occurrence]);
const sourceCache = new Map<string, CodeBlock[]>();
export function codeBlocks(markdown: string): CodeBlock[] {
  const cached = sourceCache.get(markdown);
  if (cached) return cached;
  const result:CodeBlock[]=[], languages=new Map<string,number>(), occurrences=new Map<string,number>();
  for(const block of parseBlocks(markdown)){
    const language=canonicalLanguage(block.language),signature=JSON.stringify([block.language.toLowerCase(),block.code]);
    const index=(languages.get(language)||0)+1,occurrence=occurrences.get(signature)||0;
    languages.set(language,index);occurrences.set(signature,occurrence+1);
    result.push({...block,index,occurrence});
  }
  // Keep only the current and previous revision; run reconciliation compares both.
  // Callers treat this source index as immutable.
  sourceCache.set(markdown,result);
  if(sourceCache.size>2)sourceCache.delete(sourceCache.keys().next().value!);
  return result;
}

