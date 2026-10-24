export function localPath(document: string, url: string): string;
export function link(document: string, target: string): string;
export function links(content: string): Promise<any[]>;
export function rewrite(content: string, document: string, from: string | {from:string;to:string}[], to?: string, files?: string[]): Promise<string>;
export function referencePath(document: string, node: any, files?: string[]): Promise<string>;
