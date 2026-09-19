import assert from 'node:assert/strict';
import test from 'node:test';
import checker from '../../tools/gd-test/checks/test-architecture.check.mjs';

const services = { relativePath: (_root, file) => file };

test('test architecture checker enforces dependency direction', () => {
    const result = checker.run({
        project: {
            root: '',
            sourceFiles: ['tests/unit/a.test.mjs', 'tests/harness/host.mjs'],
            sources: new Map(),
            importRecords: [
                { importerRelative: 'tests/unit/a.test.mjs', resolved: 'tests/unit/b.test.mjs', line: 2 },
                { importerRelative: 'tests/unit/a.test.js', resolved: 'tests/unit/b.test.js', line: 2 },
                { importerRelative: 'tests/harness/host.mjs', resolved: 'systems/director.js', line: 3 },
                { importerRelative: 'tests/unit/a.test.mjs', resolved: 'tests/harness/fake-st-host.mjs', line: 4 },
            ],
        },
        services,
    });

    assert.deepEqual(result.issues.map(issue => issue.code), [
        'TEST_IMPORT_TEST',
        'TEST_IMPORT_TEST',
        'HARNESS_PRODUCTION_DEP',
        'UNIT_FAKE_HOST',
    ]);
});

test('test architecture checker warns when platform modules exceed review thresholds', () => {
    const result = checker.run({
        project: {
            root: '',
            sourceFiles: ['tools/gd-test/cli.mjs'],
            importRecords: [],
            sources: new Map([['tools/gd-test/cli.mjs', Array(102).fill('line').join('\n')]]),
        },
        services,
    });
    assert.equal(result.issues.length, 1);
    assert.equal(result.issues[0].code, 'TEST_MODULE_SIZE');
});
