import { syntheticWorkerMain } from '../providers/synthetic-worker.js';
import { checkedSyntheticReport } from '../providers/test-contract.js';
import { prepareProviderDraft } from '../providers/draft.js';

/** Trusted bridge in an opaque-origin frame; candidate code is sent ONLY to a Worker. */
function frameMain(workerSource) {
    let used = false;
    window.addEventListener('message', event => {
        if (used || event.source !== parent || !event.ports[0]) return;
        used = true;
        const hostPort = event.ports[0];
        let worker, url, finished = false;
        const finish = report => { if (finished) return; finished = true; worker?.terminate(); hostPort.postMessage(report); hostPort.close(); if (url) URL.revokeObjectURL(url); };
        try {
            url = URL.createObjectURL(new Blob([workerSource], { type: 'application/javascript' }));
            worker = new Worker(url, { type: 'module' });
            hostPort.onmessage = () => finish({ status: 'cancelled', phase: 'startup', rows: [] });
            const channel = new MessageChannel();
            channel.port1.onmessage = reply => { channel.port1.close(); finish(reply.data); };
            worker.onerror = () => finish({ status: 'failed', phase: 'load', rows: [] });
            // No Worker-global onmessage: candidate postMessage() cannot spoof the private port.
            worker.postMessage(event.data, [channel.port2]);
        } catch { finish({ status: 'unavailable', phase: 'startup', rows: [] }); }
    });
}

export function createBrowserSyntheticTester({ workerMain, prepare, check, doc = globalThis.document, Channel = globalThis.MessageChannel, timeoutMs = 5000 } = {}) {
    return async function test(content, { signal } = {}) {
        const checked = prepare(content);
        const failure = status => ({ status, phase: 'startup', rows: [] });
        if (signal?.aborted) return failure('cancelled');
        if (!doc?.body || typeof Channel !== 'function') return failure('unavailable');
        return new Promise(resolve => {
            let frame, channel, timer, settled = false, pendingStop = null;
            const finish = value => {
                if (settled) return; settled = true;
                clearTimeout(timer); signal?.removeEventListener('abort', cancel);
                channel?.port1.close(); channel?.port2.close(); frame?.remove();
                try { resolve(check(value, checked)); }
                catch { resolve(failure('failed')); }
            };
            const stop = status => {
                if (settled || pendingStop) return;
                pendingStop = failure(status);
                clearTimeout(timer);
                try { channel?.port1.postMessage({ stop: true }); } catch { /* Startup may not have transferred the port yet. */ }
                // The frame acknowledges only after terminating its worker. Broken frames fail closed.
                timer = setTimeout(() => finish(pendingStop), 100);
            };
            const cancel = () => stop('cancelled');
            try {
                frame = doc.createElement('iframe'); frame.hidden = true;
                frame.setAttribute('sandbox', 'allow-scripts'); frame.setAttribute('referrerpolicy', 'no-referrer');
                const worker = `(${workerMain.toString()})();`;
                const bootstrap = `(${frameMain.toString()})(${JSON.stringify(worker)});`.replace(/<\/script/gi, '<\\/script');
                frame.srcdoc = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' blob:; worker-src blob:; connect-src 'none'; base-uri 'none'; form-action 'none'"><script>${bootstrap}</script>`;
                channel = new Channel(); channel.port1.onmessage = event => finish(pendingStop || event.data);
                frame.onload = () => {
                    if (settled || pendingStop) return;
                    frame.contentWindow.postMessage(checked, '*', [channel.port2]);
                };
                timer = setTimeout(() => stop('timeout'), timeoutMs);
                signal?.addEventListener('abort', cancel, { once: true });
                doc.body.append(frame);
            } catch { finish(failure('unavailable')); }
        });
    };
}

export function createBrowserProviderTester(options = {}) {
    return createBrowserSyntheticTester({ ...options, workerMain: syntheticWorkerMain,
        prepare: content => { const checked = prepareProviderDraft(content, { existingName: true }); return { source: checked.source, ids: checked.ids }; },
        check: (value, checked) => checkedSyntheticReport(value, checked.ids) });
}
