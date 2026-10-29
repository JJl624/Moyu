let dismiss:(()=>void)|undefined;

export function dismissControlOverlay(){
  if(!dismiss)return false;
  const close=dismiss;dismiss=undefined;close();return true;
}

/** An anchored control consumes Back before the surrounding page does. */
export function registerControlOverlay(close:()=>void){
  dismissControlOverlay();dismiss=close;
  return()=>{if(dismiss===close)dismiss=undefined;};
}
