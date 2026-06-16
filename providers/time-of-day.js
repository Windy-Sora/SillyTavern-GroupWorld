import { registerProvider } from '../provider-registry.js';

// Month-based seasons (Northern Hemisphere)
const SEASONS_ZH = ['冬','春','夏','秋'];
const SEASONS_EN = ['Winter','Spring','Summer','Autumn'];

function getSeason(month) {
    // Dec(11), Jan(0), Feb(1) → Winter → 0
    // Mar(2), Apr(3), May(4) → Spring → 1
    // Jun(5), Jul(6), Aug(7) → Summer → 2
    // Sep(8), Oct(9), Nov(10) → Autumn → 3
    return Math.floor(((month + 1) % 12) / 3);
}

function getTimeOfDay(hour) {
    if (hour >= 0 && hour < 4)   return 'midnight';
    if (hour >= 4 && hour < 6)   return 'dawn';
    if (hour >= 6 && hour < 12)  return 'morning';
    if (hour >= 12 && hour < 17) return 'afternoon';
    if (hour >= 17 && hour < 21) return 'evening';
    if (hour >= 21 && hour < 24) return 'night';
    return 'midnight';
}

const LABELS = {
    midnight:  { zh: '午夜', en: 'Midnight' },
    dawn:      { zh: '黎明', en: 'Dawn' },
    morning:   { zh: '早晨', en: 'Morning' },
    afternoon: { zh: '下午', en: 'Afternoon' },
    evening:   { zh: '傍晚', en: 'Evening' },
    night:     { zh: '深夜', en: 'Night' },
};

export function register(settings) {
    registerProvider({
        id: 'timeOfDay',
        placeholder: '{{timeOfDay}}',
        render: () => {
            const now = new Date();
            const hour = now.getHours();
            const month = now.getMonth();
            const tod = getTimeOfDay(hour);
            const si = getSeason(month);
            const zh = settings.lang === 'zh';

            return {
                content: zh ? `${SEASONS_ZH[si]} · ${LABELS[tod].zh}` : `${SEASONS_EN[si]} · ${LABELS[tod].en}`,
                data: {
                    timeOfDay: tod,
                    timeOfDayZh: LABELS[tod].zh,
                    timeOfDayEn: LABELS[tod].en,
                    season: si,
                    seasonZh: SEASONS_ZH[si],
                    seasonEn: SEASONS_EN[si],
                    hour,
                    month: month + 1,
                },
            };
        },
    });
}
