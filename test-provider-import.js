/**
 * Test Provider — demonstrates the user import system.
 * Drop this file via 资产管理 → 导入 Provider → 选择此文件.
 *
 * Registers {{testUserProvider}} which returns "Hello from user provider!"
 * with structured data for path queries.
 */
export function register({ registerProvider, log }) {
    registerProvider({
        id: 'testUserProvider',
        placeholder: '{{testUserProvider}}',
        render: () => {
            log('[testUserProvider] rendered!');
            return {
                content: 'Hello from user provider! Import success.',
                data: {
                    message: 'Import works!',
                    timestamp: Date.now(),
                    items: ['alpha', 'beta', 'gamma'],
                    nested: { key: 'value' },
                },
            };
        },
    });

    log('[testUserProvider] registered successfully');
}
