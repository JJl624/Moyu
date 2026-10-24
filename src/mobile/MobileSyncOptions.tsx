import {NumberField} from '../NumberField';
import {policy,type SyncPolicy} from '../../shared/sync-policy.mjs';
import {MobileSelect} from './MobileSelect';
export function MobileSyncOptions({value,busy,change,persist}:{value?:Partial<SyncPolicy>;busy:boolean;change(value:SyncPolicy):void;persist():void}){
  const settings=policy(value),set=(patch:Partial<SyncPolicy>)=>change({...settings,...patch});
  return <details className='mobile-sync-options mobile-sync-card'><summary>同步选项</summary>
    <section className='mobile-sync-option-group' aria-label='自动同步'><h3>自动同步</h3>
    {([{key:'onOpen',label:'启动或回到前台时同步'},{key:'afterSave',label:'保存后同步'}] as const).map(item=><label className='mobile-sync-option' key={item.key}><span>{item.label}</span><input type='checkbox' aria-label={item.label} disabled={busy} checked={settings[item.key]} onChange={event=>set({[item.key]:event.target.checked})} onBlur={persist}/></label>)}
    <label className='mobile-sync-option'><span>定时同步间隔</span><fieldset disabled={busy} onBlur={persist}><NumberField label='定时同步间隔' value={settings.interval} min={0} max={1440} change={value=>set({interval:Math.round(value)})}/><small>分钟</small></fieldset></label>
    <p className='mobile-caption'>间隔为 0 时关闭定时同步。自动同步只在前台运行，至少间隔 30 秒；首次需手动同步。</p>
    </section><section className='mobile-sync-option-group' aria-label='同步内容'><h3>同步内容</h3>
    <label className='mobile-sync-option'><span>同步代码数据</span><input aria-label='同步代码数据' type='checkbox' checked={settings.includeCodeData} disabled={busy} onChange={event=>set({includeCodeData:event.target.checked})} onBlur={persist}/></label>
    <MobileSelect className='mobile-sync-option' label='删除策略' value={settings.deletion} disabled={busy} change={deletion=>set({deletion:deletion as SyncPolicy['deletion']})} commit={persist} options={[{value:'confirm',label:'删除前确认'},{value:'sync',label:'同步删除'},{value:'keep',label:'不同步删除'}]}/>
    <label className='mobile-sync-excludes'>排除规则<textarea aria-label='排除规则' rows={3} placeholder={'*.tmp\n草稿/\n**/cache/**'} value={settings.excludes} disabled={busy} onChange={event=>set({excludes:event.target.value})} onBlur={persist}/></label>
    <p className='mobile-caption'>每行一条，支持 *、? 和 **。目录名以 / 结尾。</p>
    </section><section className='mobile-sync-option-group' aria-label='网络'><h3>网络</h3>
    {([{key:'timeout',label:'请求超时',min:5,max:600,unit:'秒'},{key:'retries',label:'失败重试次数',min:0,max:5,unit:'次'},{key:'maxFileMB',label:'单文件大小上限',min:1,max:1024,unit:'MB'}] as const).map(item=><label className='mobile-sync-option' key={item.key}><span>{item.label}</span><fieldset disabled={busy} onBlur={persist}><NumberField label={item.label} value={settings[item.key]} min={item.min} max={item.max} change={value=>set({[item.key]:Math.round(value)})}/><small>{item.unit}</small></fieldset></label>)}
    </section></details>;
}
