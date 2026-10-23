import { bindAutoSave } from './auto-save.js';

/** Collection is separate from model permission. Local UI shows metadata only. */
export function createStPromptSnapshotsView({doc,settings,controller,act,lang}){
    const t=(zh,en)=>lang==='en'?en:zh;
    const section=doc.createElement('details');section.className='gd-muyu-settings-card';settings.append(section);
    const node=(tag,text,parent=section)=>{const el=doc.createElement(tag);el.textContent=text;parent.append(el);return el;};
    node('summary',t('酒馆提示词构建快照','ST prompt build snapshots'));
    const label=node('label',t('采集提示词文字（默认关闭）','Capture prompt text (off by default)'));label.className='checkbox_label';const input=doc.createElement('input');input.type='checkbox';label.append(input);
    node('small',t('可能包含聊天、角色和世界书私人正文。仅启用后的最近一次，最多10万字符／每段1.6万／每类128项，30分钟本页内存；不存入设置。概况与正文外发分别授权。','May contain private chat, character and lore text. Latest event after enabling only; 100k chars total / 16k per block / 128 items per kind, 30 minutes in page memory, not stored in settings. Metadata and text require separate model grants.'));
    node('small',t('构建事件不是最终发送证明。注册注入项不证明实际采用；不主动生成、dry-run或渲染。关闭或清空删除快照，无法撤回已经外发的资料及存档回答。','Build event is not proof of final transmission. Registered injections are not proof of adoption. Never starts generation, dry-run or rendering. Disabling/clearing deletes snapshot, not sent data or archived answers.'));
    const actions=node('div','');actions.className='gd-muyu-settings-actions';const output=node('pre','');output.hidden=true;output.className='gd-muyu-diagnostics-records';const feedback=node('small','');let dirty=false,busy=false;
    input.onchange=()=>{dirty=true;};
    const button=(zh,en,fn)=>{const b=node('button',t(zh,en),actions);b.type='button';b.className='menu_button';b.onclick=()=>act(fn);return b;};
    const save=button('保存快照采集设置','Save capture settings',async()=>{if(busy)return;busy=true;save.disabled=input.disabled=true;feedback.textContent=t('保存中…','Saving…');try{await controller.savePromptCaptureConfig({enabled:input.checked});dirty=false;save.hidden=true;feedback.textContent=t('已保存','Saved');}catch{save.hidden=false;feedback.textContent=t('保存失败，采集设置未更新','Save failed; capture settings unchanged');}finally{busy=false;save.disabled=input.disabled=false;}});
    bindAutoSave([input],save,lang);
    button('查看最近概况','View latest overview',()=>{output.textContent=JSON.stringify(controller.promptCaptureSnapshot(),null,2);output.hidden=false;});
    button('清空快照','Clear snapshot',()=>{controller.clearPromptCapture();output.textContent='';output.hidden=true;});
    return{render(state){const config=state.promptCapture?.config||{};if(!dirty&&!busy)input.checked=config.enabled===true;if(!config.enabled||!state.promptCapture?.available){output.textContent='';output.hidden=true;}}};
}
