import { registerProvider } from '../provider-registry.js';

// Echo test provider — returns fixed structured data for template syntax testing.
// {{test}}                  → "Hello from test provider"
// {{?test:greeting}}        → "Hello World"
// {{?test:nested.value}}    → 42
// {{?test:items[0]}}        → "apple"
// {{?test:items[1]}}        → "banana"
// {{?test:missing\|fallback}} → "fallback"
export function register() {
    registerProvider({
        id: 'test',
        placeholder: '{{test}}',
        render: () => ({
            content: 'Hello from test provider',
            data: {
                greeting: 'Hello World',
                nested: { value: 42 },
                items: ['apple', 'banana', 'cherry'],
            },
        }),
    });
}
