import { bindAutoSave } from './auto-save.js';

/** Local inspection does not grant model access or export logs. */
export function createStDiagnosticsView({ doc, settings, controller, act, lang }) {
    const t = (zh, en) => lang === 'en' ? en : zh;
    const section = doc.createElement('details'); section.className = 'gd-muyu-settings-card'; settings.append(section);
    const title = doc.createElement('summary'); title.textContent = t('酒馆本地诊断', 'Local ST diagnostics'); section.append(title);
    const toggles = [];
    for (const [key, zh, en] of [['enabled', '采集本地诊断（默认关闭）', 'Collect local diagnostics (off by default)'], ['browserErrors', '记录浏览器错误计数（不含详情）', 'Count browser errors (no details)']]) {
        const label = doc.createElement('label'); label.className = 'checkbox_label'; const input = doc.createElement('input'); input.type = 'checkbox';
        label.textContent = t(zh, en); label.append(input); section.append(label); toggles.push([key, input]);
    }
    const hint = doc.createElement('small'); hint.textContent = t('仅本页，最多200项／30分钟；关闭或清空即删除。查看不外发；暮羽读取另需来源授权。不含服务器日志，结束事件不代表成功。', 'This page only: 200 events / 30 minutes. Disabling or clearing deletes records. Local viewing does not send data; model reads need separate permission. No server logs; ended does not mean success.'); section.append(hint);
    const privacy = doc.createElement('small'); privacy.textContent = t('清空不撤回已外发资料；已产生的回答与工具轨迹仍遵循对话存储设置。', 'Clearing cannot recall sent data; existing answers and tool traces follow conversation storage settings.'); section.append(privacy);
    const actions = doc.createElement('div'); actions.className = 'gd-muyu-settings-actions'; section.append(actions);
    const output = doc.createElement('pre'); output.hidden = true; output.className = 'gd-muyu-diagnostics-records'; section.append(output);
    const feedback = doc.createElement('small'); feedback.textContent = ''; section.append(feedback);
    let busy = false, dirty = false;
    for (const [, input] of toggles) input.onchange = () => { dirty = true; };
    const button = (zh, en, work) => { const b = doc.createElement('button'); b.type = 'button'; b.className = 'menu_button'; b.textContent = t(zh, en); actions.append(b); b.onclick = () => act(work); return b; };
    const save = button('保存诊断设置', 'Save diagnostics', async () => { if (busy) return; busy = true;
        feedback.textContent = t('保存中…', 'Saving…');
        save.disabled = true; for (const [, input] of toggles) input.disabled = true;
        try { await controller.saveDiagnosticsConfig(Object.fromEntries(toggles.map(([key, input]) => [key, input.checked]))); dirty = false; save.hidden = true; feedback.textContent = t('已保存', 'Saved'); }
        catch { save.hidden = false; feedback.textContent = t('保存失败，未更新采集设置', 'Save failed; collection settings unchanged'); }
        finally { busy = false; save.disabled = false; for (const [, input] of toggles) input.disabled = false; }
    });
    bindAutoSave(toggles.map(([, input]) => input), save, lang);
    button('查看本地记录', 'View local records', () => { output.textContent = JSON.stringify(controller.diagnosticsSnapshot(), null, 2); output.hidden = false; });
    button('清空本地记录', 'Clear local records', () => { controller.clearDiagnostics(); output.textContent = ''; output.hidden = true; });
    return { render(state) { const config = state.diagnostics?.config || {}; if (!dirty && !busy) for (const [key, input] of toggles) input.checked = config[key] === true;
        save.disabled = busy; if (config.enabled !== true) { output.textContent = ''; output.hidden = true; } } };
}
