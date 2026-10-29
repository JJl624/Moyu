export interface FormulaSession {
  value:string;
  display:boolean;
  apply(value:string):boolean;
  restore():void;
}
export function requestFormula(session:FormulaSession|null|undefined){
  if(session)window.dispatchEvent(new CustomEvent<FormulaSession>('moyu-edit-formula',{detail:session}));
}
