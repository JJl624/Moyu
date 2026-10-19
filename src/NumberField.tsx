import { useEffect, useState } from 'react';
export function NumberField({label,value,min,max,step=1,change}:{label:string;value:number;min:number;max:number;step?:number;change:(value:number)=>void}) {
  const [text,setText]=useState(String(value)),[editing,setEditing]=useState(false);
  useEffect(()=>{if(!editing)setText(String(value));},[value,editing]);
  const commit=()=>{const next=Number(text);if(text.trim()&&Number.isFinite(next))change(Math.min(max,Math.max(min,next)));else setText(String(value));setEditing(false);};
  return <input className="number-input" type="number" inputMode="decimal" aria-label={label} min={min} max={max} step={step} value={text} onFocus={()=>setEditing(true)} onChange={e=>{setText(e.target.value);const n=Number(e.target.value);if(e.target.value&&Number.isFinite(n)&&n>=min&&n<=max)change(n);}} onBlur={commit} onKeyDown={e=>{if(e.key==='Enter'){commit();e.currentTarget.blur();}}}/>;
}
