/** Saving never calls updateList (which selects). Selection awaits the official after event. */
export function createNativePresetApi({getContext,getHeaders,fetch:request=globalThis.fetch,getSelect,timeoutMs=10000}) {
    return Object.freeze({
        async save(name,preset){const manager=getContext().getPresetManager('openai'),initial=manager.getPresetList(),select=getSelect();
            if(!Array.isArray(initial.presets)||!initial.preset_names||Array.isArray(initial.preset_names)||!select||['__proto__','constructor','prototype'].includes(name))throw Error('PRESET_CACHE_UNAVAILABLE');
            const baseline=JSON.stringify(initial.presets),names=JSON.stringify(initial.preset_names),oldSelection=select.value;
            const response=await request('/api/presets/save',{method:'POST',headers:getHeaders(),body:JSON.stringify({apiId:'openai',name,preset})});if(!response.ok)throw Error('PRESET_SAVE_UNKNOWN');const result=await response.json();if(result.name!==name)throw Error('PRESET_SAVE_UNKNOWN');
            const {presets,preset_names}=manager.getPresetList();if(getContext().getPresetManager('openai')!==manager||getSelect()!==select||JSON.stringify(presets)!==baseline||JSON.stringify(preset_names)!==names||select.value!==oldSelection)throw Error('PRESET_CACHE_CHANGED');
            if(Object.hasOwn(preset_names,name)){const index=preset_names[name];if(!Number.isInteger(index)||index<0||index>=presets.length)throw Error('PRESET_CACHE_UNAVAILABLE');presets[index]=structuredClone(preset);}
            else{const oldValue=select.value,option=select.ownerDocument.createElement('option');option.value=String(presets.length);option.textContent=name;option.selected=false;presets.push(structuredClone(preset));preset_names[name]=presets.length-1;select.append(option);select.value=oldValue;}
        },
        select(name){const ctx=getContext(),manager=ctx.getPresetManager('openai'),value=manager.findPreset(name),type=ctx.eventTypes?.PRESET_CHANGED;if(value===undefined||value===null||!type||!ctx.eventSource?.on||!ctx.eventSource?.removeListener)throw Error('PRESET_SELECTION_UNAVAILABLE');
            return new Promise((resolve,reject)=>{let timer,finished=false;const done=(error)=>{if(finished)return;finished=true;clearTimeout(timer);ctx.eventSource.removeListener(type,listener);error?reject(error):resolve();};const listener=data=>{if(data?.apiId==='openai'&&data.name===name)done();};ctx.eventSource.on(type,listener);timer=setTimeout(()=>done(Error('PRESET_SELECTION_UNKNOWN')),timeoutMs);try{manager.selectPreset(value);}catch{done(Error('PRESET_SELECTION_UNKNOWN'));}});
        },
    });
}
