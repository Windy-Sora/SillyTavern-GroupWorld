import { registerProvider } from '../../provider-registry.js';

// Lunar cycle in days
const SYNODIC_MONTH = 29.53058867;
// Known new moon: Jan 6 2000 18:14 UTC
const REF_NEW_MOON = new Date(Date.UTC(2000, 0, 6, 18, 14)).getTime();

function calcMoon() {
    const now = Date.now();
    const days = (now - REF_NEW_MOON) / 86400000;
    const age = ((days % SYNODIC_MONTH) + SYNODIC_MONTH) % SYNODIC_MONTH;
    const phase = age / SYNODIC_MONTH; // 0-1, 0=new moon
    const illum = Math.round((1 - Math.cos(phase * Math.PI * 2)) / 2 * 100);

    // Determine phase name
    const zhNames = ['新月','蛾眉月','上弦月','盈凸月','满月','亏凸月','下弦月','残月'];
    const enNames = ['New Moon','Waxing Crescent','First Quarter','Waxing Gibbous','Full Moon','Waning Gibbous','Last Quarter','Waning Crescent'];
    const idx = Math.round(phase * 8) % 8;

    return {
        phase: Math.round(phase * 1000) / 1000,
        age: Math.round(age * 100) / 100,
        illumination: illum,
        index: idx,
        nameZh: zhNames[idx],
        nameEn: enNames[idx],
    };
}

export function register(settings) {
    registerProvider({
        id: 'moonPhase',
        placeholder: '{{moonPhase}}',
        render: () => {
            const m = calcMoon();
            const zh = settings.lang === 'zh';

            const content = zh
                ? `${m.nameZh} (光照${m.illumination}%, 月龄${m.age}天)`
                : `${m.nameEn} (${m.illumination}% illuminated, age ${m.age}d)`;

            return {
                content,
                data: {
                    phase: m.phase,
                    age: m.age,
                    illumination: m.illumination,
                    index: m.index,
                    nameZh: m.nameZh,
                    nameEn: m.nameEn,
                },
            };
        },
    });
}
