let settings={longPressTimeout:500,doubleTapTimeout:300,touchSlop:8};
export const touchSettings=()=>settings;
export function setTouchSettings(value:Partial<typeof settings>){
  for(const key of Object.keys(settings) as (keyof typeof settings)[]){
    const number=Number(value[key]);
    if(Number.isFinite(number)&&number>0)settings={...settings,[key]:number};
  }
}
