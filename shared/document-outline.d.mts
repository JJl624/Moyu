export interface OutlineHeading{text:string;level:number;offset:number;}
export interface OutlineNode extends OutlineHeading{index:number;depth:number;children:OutlineNode[];}
export function headingText(source:string):string;
export function documentHeadings(markdown:string):OutlineHeading[];
export function headingTree(headings:readonly OutlineHeading[]):OutlineNode[];
