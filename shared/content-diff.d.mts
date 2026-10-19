export interface DiffPiece {value:string;changed:boolean}
export function compareText(left:string,right:string):{left:DiffPiece[];right:DiffPiece[]};
