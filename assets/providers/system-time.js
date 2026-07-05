import { registerProvider } from '../../provider-registry.js';

export function register(settings) {
    registerProvider({
        id: 'systemTime',
        placeholder: '{{systemTime}}',
        render: () => {
            const now = new Date();
            const iso = now.toISOString();
            const zh = settings.lang === 'zh';

            const content = zh
                ? `${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日 ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')} 周${['日','一','二','三','四','五','六'][now.getDay()]}`
                : now.toLocaleString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });

            return {
                content,
                data: {
                    iso,
                    year: now.getFullYear(),
                    month: now.getMonth() + 1,
                    day: now.getDate(),
                    hour: now.getHours(),
                    minute: now.getMinutes(),
                    second: now.getSeconds(),
                    weekday: now.getDay(),
                    weekdayName: zh
                        ? ['日','一','二','三','四','五','六'][now.getDay()]
                        : ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][now.getDay()],
                    timestamp: now.getTime(),
                },
            };
        },
    });
}
