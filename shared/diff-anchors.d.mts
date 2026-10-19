export interface DiffAnchor { a: number; b: number; length: number; }
export function diffAnchors(diff: {left:{value:string;changed:boolean}[];right:{value:string;changed:boolean}[]}): DiffAnchor[];
export function mapDiffOffset(anchors: DiffAnchor[], offset: number, from?: 'a'|'b'): number | undefined;
