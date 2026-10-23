import {copyJson} from '../core/json-contract.js';
import {slugifyId} from '../../systems/variable-system.js';
const record=v=>v&&typeof v==='object'&&!Array.isArray(v);
/** Shared pure completion-variable contract. No initialization, getters or writes. */
export function inspectBlueprintCompletion(settings,root) {
 const id=settings.storyBlueprintCompletionVariable||'gd_story_chapter_done',vars=root?.variables;
 if(typeof id!=='string'||!(/^[a-z0-9](?:[a-z0-9_]{0,62}[a-z0-9])?$/).test(id)||['constructor','prototype'].includes(id))throw Error('COMPLETION_VARIABLE_CONFLICT');
 if(vars!==undefined&&(!record(vars)||!Array.isArray(vars.defs)||!record(vars.values)||!record(vars.values.global)||!record(vars.values.character)))throw Error('COMPLETION_VARIABLE_CONFLICT');
 const defs=vars?.defs.filter(d=>slugifyId(d?.id)===id)||[],definition=defs[0]||null;
 const stored=Object.hasOwn(vars?.values.global||{},id),value=stored?vars.values.global[id]:null;
 if(defs.length>1||definition&&(definition.id!==id||definition.type!=='boolean'||definition.scope!=='global'||definition.locked||
  definition.owner&&definition.owner!=='group-director-story-blueprint'||settings.storyBlueprintCompletionVariableGuard===id&&definition.owner!=='group-director-story-blueprint')||
  stored&&typeof value!=='boolean'||definition?.defaultValue!==undefined&&typeof definition.defaultValue!=='boolean'||
  !definition&&(stored||Object.hasOwn(vars?.values.character||{},id)))throw Error('COMPLETION_VARIABLE_CONFLICT');
 return {vars,completion:copyJson({id,exists:!!definition,stored,value,definition})};
}
