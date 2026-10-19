export function wikiSyntax(tree:any,content:string):any;
export function wikiDimensions(parameter?:string):{width:number;height?:number}|null;
export function wikiPath(document:string,target:string,files?:Array<string|{path:string}>):string;
export function wikiEmbed(target:string,parameter?:string):string;
