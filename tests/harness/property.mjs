import assert from 'node:assert/strict';
import test from 'node:test';

function normalizeSeed(value) {
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) ? parsed >>> 0 : 4_674_628;
}

export function createRandom(seed = process.env.GD_TEST_SEED) {
    let state = normalizeSeed(seed);
    return {
        seed: state,
        next() {
            state += 0x6D2B79F5;
            let value = state;
            value = Math.imul(value ^ (value >>> 15), value | 1);
            value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
            return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
        },
        integer(min, max) {
            assert.ok(Number.isInteger(min) && Number.isInteger(max) && max >= min);
            return min + Math.floor(this.next() * (max - min + 1));
        },
        pick(values) {
            assert.ok(Array.isArray(values) && values.length > 0);
            return values[this.integer(0, values.length - 1)];
        },
        string({ minLength = 0, maxLength = 24, alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789' } = {}) {
            const length = this.integer(minLength, maxLength);
            let value = '';
            for (let i = 0; i < length; i++) value += alphabet[this.integer(0, alphabet.length - 1)];
            return value;
        },
    };
}

/**
 * Deterministic property test. Failures include the seed, case index and input
 * so the exact generated case can be reproduced with --seed.
 */
export function property(name, options, generate, verify) {
    if (typeof options === 'function') {
        verify = generate;
        generate = options;
        options = {};
    }
    const {
        cases = 100,
        seed = process.env.GD_TEST_SEED,
        timeout = 5000,
    } = options || {};

    return test(name, { timeout }, async () => {
        const random = createRandom(seed);
        for (let index = 0; index < cases; index++) {
            const input = await generate(random, index);
            try {
                await verify(input, { assert, random, index, seed: random.seed });
            } catch (error) {
                error.message = `${error.message}\nProperty seed=${random.seed} case=${index} input=${JSON.stringify(input)}`;
                throw error;
            }
        }
    });
}
