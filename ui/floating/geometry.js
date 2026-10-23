/** Browser-only geometry; no chat, task or model state. */
export function visibleViewport(win, insets = {}) {
    const visual = win.visualViewport;
    const width = visual?.width > 0 ? visual.width : win.innerWidth;
    const height = visual?.height > 0 ? visual.height : win.innerHeight;
    const left = Math.max(0, insets.left || 0), top = Math.max(0, insets.top || 0);
    return { x: (visual?.offsetLeft || 0) + left, y: (visual?.offsetTop || 0) + top,
        width: Math.max(1, width - left - Math.max(0, insets.right || 0)),
        height: Math.max(1, height - top - Math.max(0, insets.bottom || 0)) };
}

export function isMobileViewport(win) {
    return win.innerWidth <= 600 || (win.innerWidth <= 900 && win.matchMedia?.('(pointer: coarse)').matches === true);
}

export function validBallPosition(value) {
    return value && ['left', 'right'].includes(value.side) && Number.isFinite(value.fraction) && value.fraction >= 0 && value.fraction <= 1
        ? { side: value.side, fraction: value.fraction } : { side: 'right', fraction: 0.9 };
}

export function dockedBallRect(position, viewport, tucked = false, size = 48) {
    const { side, fraction } = validBallPosition(position), x = viewport.x || 0, y = viewport.y || 0;
    return { width: size, height: size,
        x: side === 'left' ? x + 8 - (tucked ? size / 2 : 0) : x + Math.max(8, viewport.width - size - 8) + (tucked ? size / 2 : 0),
        y: y + 8 + Math.max(0, viewport.height - size - 16) * fraction };
}

/** Anchor a compact panel above/below the launcher without covering it. */
export function mobilePanelRect(ball, area, enlarged = false) {
    const x = area.x || 0, y = area.y || 0, margin = 12, gap = 12;
    const width = Math.max(1, Math.min(enlarged ? area.width : Math.min(340, area.width * 0.86), area.width - margin * 2));
    if (enlarged) return { x: x + margin, y: y + margin, width, height: Math.max(1, area.height - 96) };
    const above = Math.max(1, ball.y - gap - y - margin);
    const below = Math.max(1, y + area.height - margin - ball.y - ball.height - gap);
    const preferred = Math.max(1, Math.min(440, area.height * 0.6, area.height - 96));
    const useAbove = above >= preferred || (below < preferred && above >= below);
    const height = Math.min(preferred, useAbove ? above : below);
    return { width, height, x: Math.max(x + margin, Math.min(ball.x + (ball.width - width) / 2, x + area.width - width - margin)),
        y: useAbove ? ball.y - gap - height : ball.y + ball.height + gap };
}
