/** Presentation only. Never exposes prompts, identities, tool arguments or errors. */
export function muyuFloatingState(s = {}) {
    if (s.resetting || s.draining) return { status: 'running', displayState: 'executing' };
    if (s.busy) {
        const phase = s.activity?.phase;
        const thinking = s.context?.compacting || phase === 'model.started';
        return { status: 'running', displayState: thinking ? 'thinking' : 'executing' };
    }
    if (s.interaction?.status === 'pending' || s.notice) return { status: 'attention', displayState: 'waiting' };
    const last = s.runs?.at(-1);
    if (last?.status === 'failed') return { status: 'error', displayState: 'error' };
    if (last?.status === 'succeeded') return { status: 'idle', displayState: 'completed' };
    return { status: 'idle', displayState: 'idle' };
}
