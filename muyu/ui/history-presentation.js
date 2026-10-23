/** Local display only: do not change ordering, storage timestamps or session identity. */
export function historyDatePresentation(timestamp, lang = 'zh', now = new Date()) {
    const en = lang === 'en';
    const date = typeof timestamp === 'number' && Number.isFinite(timestamp) && timestamp >= 0 ? new Date(timestamp) : null;
    if (!date || !Number.isFinite(date.getTime())) return { group: 'unknown', label: en ? 'Unknown date' : '日期未知', time: '', full: '' };
    const day = value => new Date(value.getFullYear(), value.getMonth(), value.getDate());
    const today = day(now), yesterday = new Date(today); yesterday.setDate(yesterday.getDate() - 1);
    const storedDay = day(date).getTime();
    const group = storedDay === today.getTime() ? 'today' : storedDay === yesterday.getTime() ? 'yesterday' : storedDay < yesterday.getTime() ? 'earlier' : 'future';
    const label = ({ today: en ? 'Today' : '今天', yesterday: en ? 'Yesterday' : '昨天', earlier: en ? 'Earlier' : '更早', future: en ? 'Later dates' : '之后的日期' })[group];
    const locale = en ? 'en' : 'zh-CN';
    return { group, label, time: group === 'today' || group === 'yesterday' ? date.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' }) : date.toLocaleDateString(locale, { month: 'short', day: 'numeric', year: 'numeric' }), full: date.toLocaleString(locale) };
}
