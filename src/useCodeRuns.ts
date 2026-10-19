import { useEffect, useRef, useState } from "react";
import { api } from "./bridge";
import { canonicalLanguage, codeBlocks, type CodeIdentity, codeKey } from "./codeBlocks";
import type { RunArtifact } from "./RunArtifacts";
import {releaseHTMLState,settleHTMLResults} from './htmlResultLifecycle';
import { useRunEnvironments } from './documents/useRunEnvironments';
export interface CodeResult extends CodeIdentity {
  output: string;
  error: string;
  elapsed: number;
  executionMs?: number;
  startupMs?: number;
  running?: boolean;
  artifacts?: RunArtifact[];
}
// Temporary results are session scoped; only explicitly pinned HTML is restored from disk.
export function useCodeRuns(
  root: string,
  path: string,
  markdown: string,
  tabs: string[],
  onNormalize: (content: string) => string,
) {
  useRunEnvironments(root, path, markdown, tabs);
  const scopeCache = useRef(new Map<string, Record<string, "block" | "global" | "memory">>());
  const modeCache=useRef(new Map<string,Record<string,'worker'|'dom'>>());
  const previousBlocks = useRef(new Map<string, ReturnType<typeof codeBlocks>>());
  const cache = useRef(new Map<string, Record<string, CodeResult>>()),
    active = useRef<{ document: string; key: string } | null>(null);
  const [, refresh] = useState(0), document = root + "\0" + path;
  const records = () => cache.current.get(document) || {};
  const release = (values: CodeResult[]) => {
    const tokens = values.flatMap(v =>
      (v.artifacts || []).map(a => a.token).filter((t): t is string => !!t)
    );
    releaseHTMLState(tokens);
    if (tokens.length) void settleHTMLResults({tokens}).then(()=>api.feature("code.result-release", { tokens })).catch(() => {});
  };
  const publish = (doc: string, key: string, value: CodeResult | null) => {
    const data = { ...cache.current.get(doc) };
    if (data[key] && data[key] !== value) {
      const kept=new Set(value?.artifacts?.map(a=>a.token));
      release([{...data[key],artifacts:data[key].artifacts?.filter(a=>!kept.has(a.token))}]);
    }
    if (value) data[key] = value;
    else delete data[key];
    cache.current.set(doc, data);
    refresh(n => n + 1);
  };
  useEffect(()=>{
    const change=(event:Event)=>{const detail=(event as CustomEvent).detail;for(const values of cache.current.values())for(const value of Object.values(values))for(const item of value.artifacts||[])if(item.token===detail.token)Object.assign(item,{pinned:detail.pinned,height:detail.height});refresh(n=>n+1);};
    window.addEventListener('moyu-html-pin-changed',change);return()=>window.removeEventListener('moyu-html-pin-changed',change);
  },[]);
  useEffect(()=>{
    const failed=(event:Event)=>{const {token,artifact,error}=(event as CustomEvent).detail;let found=false;for(const [doc,values]of cache.current)for(const [key,value]of Object.entries(values))if(value.artifacts?.some(a=>a.token===token)){found=true;publish(doc,key,{...value,error,artifacts:value.artifacts.map(a=>a.token===token?artifact:a)});}if(!found)release([{language:'',code:'',occurrence:0,output:'',error:'',elapsed:0,artifacts:[artifact]}]);};
    window.addEventListener('moyu-html-pin-failed',failed);return()=>window.removeEventListener('moyu-html-pin-failed',failed);
  },[]);
  useEffect(()=>{
    if(!api.desktop||!root||!path||!/\.(md|markdown)$/i.test(path))return;
    let alive=true;
    void api.feature<{id:string;artifacts:RunArtifact[]}[]>('code.pinned-results',{document:path,markdown}).then(results=>{
      if(!alive){release(results.map(r=>({...r,language:'',code:'',occurrence:0,output:'',error:'',elapsed:0})));return;}
      const blocks=codeBlocks(markdown),values=cache.current.get(document)||{};
      for(const result of results){const block=blocks.find(b=>b.id===result.id);if(block&&!values[codeKey(block)])values[codeKey(block)]={...block,...result,output:'',error:'',elapsed:0};else release([{...result,language:'',code:'',occurrence:0,output:'',error:'',elapsed:0}]);}
      cache.current.set(document,values);refresh(n=>n+1);
    }).catch(()=>{});
    return()=>{alive=false;};
  },[document]);
  useEffect(() => () => {
    for (const values of cache.current.values()) release(Object.values(values));
    cache.current.clear();
    scopeCache.current.clear();
    modeCache.current.clear();
    previousBlocks.current.clear();
    if (active.current) void api.feature('code.stop').catch(() => {});
  }, []);
  useEffect(() => {
    const opened = new Set(tabs.map(path => root + "\0" + path));
    for (const doc of cache.current.keys()) {
      if (!opened.has(doc)) {
        release(Object.values(cache.current.get(doc) || {}));
        cache.current.delete(doc);
      }
    }
    for (const doc of scopeCache.current.keys()) {
      if (!opened.has(doc)) scopeCache.current.delete(doc);
    }
    for(const doc of modeCache.current.keys())if(!opened.has(doc))modeCache.current.delete(doc);
    for (const doc of previousBlocks.current.keys()) {
      if (!opened.has(doc)) previousBlocks.current.delete(doc);
    }
    if (active.current && !opened.has(active.current.document)) {
      void api.feature("code.stop").catch(() => {});
    }
    refresh(n => n + 1);
  }, [root, tabs]);
  useEffect(() => {
    const blocks = codeBlocks(markdown), selected = { ...scopeCache.current.get(document) };
    const oldScopes=scopeCache.current.get(document)||{};
    for (const previous of previousBlocks.current.get(document) || []) {
      if (previous.id || !selected[codeKey(previous)]) continue;
      const current = blocks.find(b =>
        b.language.toLowerCase() === previous.language.toLowerCase() && b.code === previous.code
        && b.occurrence === previous.occurrence
      );
      if (current?.id && !selected[current.id]) selected[current.id] = selected[codeKey(previous)];
    }
    const identities = new Set(blocks.map(b => b.id || codeKey(b)));
    for (const id of Object.keys(selected)) if (!identities.has(id)) delete selected[id];
    scopeCache.current.set(document, selected);
    // ID-backed choices need no code snapshot. Keep only anonymous SQL choices
    // awaiting normalization, rather than every block of every open document.
    const anonymous = blocks.filter(b => !b.id && selected[codeKey(b)]);
    if (anonymous.length) previousBlocks.current.set(document, anonymous);
    else previousBlocks.current.delete(document);
    const values = { ...cache.current.get(document) }, resultKeys = Object.keys(values);
    let changed=Object.keys(selected).length!==Object.keys(oldScopes).length||Object.entries(selected).some(([key,value])=>oldScopes[key]!==value);
    if (resultKeys.length) {
      const keys = new Set(blocks.map(codeKey));
      for (const key of resultKeys) {
        if (!keys.has(key)) {
          changed=true;
          const previous=values[key],pinned=previous.artifacts?.filter(a=>a.pinned),block=blocks.find(b=>b.id&&b.id===previous.id);
          if(block&&pinned?.length){const kept=new Set(pinned.map(a=>a.token));release([{...previous,artifacts:previous.artifacts?.filter(a=>!kept.has(a.token))}]);values[codeKey(block)]={...block,output:'',error:'',elapsed:previous.elapsed,artifacts:pinned};}
          else release([previous]);
          delete values[key];
        }
      }
    }
    cache.current.set(document, values);
    if(changed)refresh(n => n + 1);
  }, [document, markdown]);
  const run = async (block: CodeIdentity, args: readonly string[] = []) => {
    if (active.current) return;
    const tokens=(records()[codeKey(block)]?.artifacts||[]).filter(a=>a.kind==='html'&&a.token).map(a=>a.token!);
    if(tokens.length)await settleHTMLResults({tokens,stop:true});
    if(active.current)return;
    let sourceMarkdown = markdown;
    {
      const choice = scopeCache.current.get(document)?.[block.id || codeKey(block)] || "block";
      const mode=modeCache.current.get(document)?.[block.id||codeKey(block)];
      sourceMarkdown = onNormalize(markdown);
      const normalizedBlocks = codeBlocks(sourceMarkdown);
      const found = normalizedBlocks.find(b =>
        b.language.toLowerCase() === block.language.toLowerCase() && b.code === block.code
        && b.occurrence === block.occurrence
      );
      if (!found) return;
      if (!found.id) {
        publish(document, codeKey(block), { ...block, output: '', error: '代码块 ID 已用完，请在新文档中运行。', elapsed: 0 });
        return;
      }
      const selected = { ...scopeCache.current.get(document) };
      const selectedModes={...modeCache.current.get(document)};
      for (const previous of codeBlocks(markdown)) {
        const anonymousKey=codeKey(previous);
        if (!selected[anonymousKey]&&!selectedModes[anonymousKey]) continue;
        const current = normalizedBlocks.find(b =>
          b.language.toLowerCase() === previous.language.toLowerCase() && b.code === previous.code
          && b.occurrence === previous.occurrence
        );
        if (current && selected[codeKey(previous)]) {
          selected[current.id] = selected[codeKey(previous)];
        }
        if(current&&selectedModes[anonymousKey]){selectedModes[current.id]=selectedModes[anonymousKey];delete selectedModes[anonymousKey];}
      }
      scopeCache.current.set(document, selected);
      modeCache.current.set(document,selectedModes);
      block = { ...block, id: found.id };
      if(mode)modeCache.current.set(document,{...modeCache.current.get(document),[found.id]:mode});
      scopeCache.current.set(document, { ...scopeCache.current.get(document), [found.id]: choice });
    }
    const key = codeKey(block), started = performance.now();
    active.current = { document, key };
    const pinned=records()[key]?.artifacts?.filter(a=>a.pinned)||[];
    const running = { ...block, output: "", error: "", elapsed: 0, running: true,artifacts:pinned };
    publish(document, key, running);
    try {
      const source = codeBlocks(sourceMarkdown).find(b => codeKey(b) === key);
      const result = await api.feature<CodeResult>("code.run", {
        ...block,
        arguments:[...args],
        root,
        document: path,
        id: source?.id || block.id,
        scope: ['SQL','Bash'].includes(canonicalLanguage(block.language))
          ? scopeCache.current.get(document)?.[block.id || codeKey(block)] || "block"
          : "block",
        markdown: sourceMarkdown,
        mode:modeCache.current.get(document)?.[block.id||codeKey(block)]||'worker',
      });
      window.dispatchEvent(new Event("moyu-code-data-changed"));
      if (cache.current.get(document)?.[key] === running) {
        publish(document, key, {
          ...block,
          ...result,
          artifacts:[...(result.artifacts||[]),...pinned.filter(old=>result.error||!result.artifacts?.some(a=>a.kind==='html'&&a.pinIndex===old.pinIndex))],
          elapsed: performance.now() - started,
          running: false,
        });
      } else release([result]);
    } catch (e) {
      if (cache.current.get(document)?.[key] === running) {
        publish(document, key, {
          ...block,
          output: "",
          error: (e as Error).message,
          artifacts:pinned,
          elapsed: performance.now() - started,
        });
      }
    } finally {
      active.current = null;
      refresh(n => n + 1);
    }
  };
  return {
    modeFor:(id:string)=>modeCache.current.get(document)?.[id]||'worker',
    setMode:(id:string,value:'worker'|'dom')=>{modeCache.current.set(document,{...modeCache.current.get(document),[id]:value});refresh(n=>n+1);},
    scopes: scopeCache.current.get(document) || {},
    scopeFor: (id: string | undefined) => scopeCache.current.get(document)?.[id || ""] || "block",
    setScope: (id: string | undefined, value: "block" | "global" | "memory") => {
      if (!id) return;
      scopeCache.current.set(document, { ...scopeCache.current.get(document), [id]: value });
      const selected = scopeCache.current.get(document)!;
      const anonymous = codeBlocks(markdown).filter(b => !b.id && selected[codeKey(b)]);
      if (anonymous.length) previousBlocks.current.set(document, anonymous);
      else previousBlocks.current.delete(document);
      refresh(n => n + 1);
    },
    values: records(),
    busy: !!active.current,
    run,
    stop: () => api.feature("code.stop"),
    close: (key: string) => {
      if (records()[key]?.running) void api.feature("code.stop");
      publish(document, key, null);
    },
  };
}
export type CodeRuns = ReturnType<typeof useCodeRuns>;
