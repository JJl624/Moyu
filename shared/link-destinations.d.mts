export function readableHref(href:string):string;
export function relativeHref(document:string,target:string):string;
export function markdownDestination(href:string,angle?:boolean):string;
export function destinationSpan(raw:string,definition?:boolean):{from:number;to:number;angle:boolean;contentFrom:number;contentTo:number}|null;
export function readableSource(node:any,markdown:string):{value:string;offsets:number[]};
