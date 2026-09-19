export default {
    excludeDirectories: [
        '.git',
        '.claude',
        '.agents',
        '.bug-hunter',
        'node_modules',
        'test-results',
        'coverage',
    ],
    sourceExtensions: ['.js', '.mjs'],
    jsonExtensions: ['.json'],
    testFilePattern: /\.test\.(?:js|mjs)$/i,
    suites: {
        unit: ['tests/unit'],
        regression: ['tests/regression'],
        integration: ['tests/integration'],
        contract: ['tests/contract'],
    },
    profiles: {
        static: { staticChecks: true, suites: [] },
        unit: { staticChecks: false, suites: ['unit'] },
        integration: { staticChecks: false, suites: ['integration', 'contract'] },
        quick: { staticChecks: true, suites: ['unit', 'regression'] },
        full: { staticChecks: true, suites: ['unit', 'regression', 'integration', 'contract'] },
    },
    staticChecks: {
        syntaxConcurrency: 8,
        checkRelativeImports: true,
        checkMergeMarkers: true,
        checkReplacementCharacters: true,
        moduleSmokeRoots: ['agents', 'systems', 'utils'],
        moduleSmokeConcurrency: 8,
    },
    test: {
        concurrency: 2,
        timeoutMs: 120_000,
        coverageIncludes: [
            '*.js',
            'agents/**/*.js',
            'assets/**/*.js',
            'systems/**/*.js',
            'ui/**/*.js',
            'utils/**/*.js',
        ],
    },
    regression: {
        // Every confirmed historical finding must remain represented by a
        // named executable behavior contract. BUG-9 was excluded from the
        // confirmed 17-item audit set.
        requiredBugIds: [
            'BUG-1', 'BUG-2', 'BUG-3', 'BUG-4', 'BUG-5', 'BUG-6',
            'BUG-7', 'BUG-8', 'BUG-10', 'BUG-11', 'BUG-12', 'BUG-13',
            'BUG-14', 'BUG-15', 'BUG-16', 'BUG-17', 'BUG-18',
        ],
    },
};
