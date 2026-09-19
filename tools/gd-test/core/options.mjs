export const HELP_TEXT = `
GD Test Lab

Usage:
  node tools/gd-test/cli.mjs [profile] [options]

Profiles:
  quick        Static checks + unit + regression tests (default)
  full         Static checks + all test suites
  static       Syntax, JSON, manifest, imports and source hygiene
  unit         Unit tests only
  integration  Fake/real SillyTavern integration and contract tests

Options:
  --filter <text>    Filter test files; if none match, filter test names
  --coverage         Enable Node's built-in test coverage
  --seed <integer>   Seed for deterministic property/fuzz tests
  --st-root <path>   SillyTavern root used by optional contract tests
  --report <path>    Write a machine-readable JSON report
  --list             List selected tests without running them
  --verbose          Print complete child-process output
  --help             Show this help
`.trim();

export function parseOptions(argv, env = process.env) {
    const options = {
        profile: 'quick',
        filter: '',
        coverage: false,
        seed: env.GD_TEST_SEED || '4674628',
        stRoot: env.GD_TEST_ST_ROOT || '',
        report: '',
        list: false,
        verbose: false,
        help: false,
    };
    let profileSet = false;
    const requireValue = (flag, value) => {
        if (!value || value.startsWith('--') || value === '-h') {
            throw new Error(`Missing value for ${flag}`);
        }
        return value;
    };
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (!arg.startsWith('-') && !profileSet) {
            options.profile = arg;
            profileSet = true;
        } else if (arg === '--filter') {
            options.filter = requireValue(arg, argv[++i]);
        } else if (arg.startsWith('--filter=')) {
            options.filter = requireValue('--filter', arg.slice('--filter='.length));
        } else if (arg === '--st-root') {
            options.stRoot = requireValue(arg, argv[++i]);
        } else if (arg.startsWith('--st-root=')) {
            options.stRoot = requireValue('--st-root', arg.slice('--st-root='.length));
        } else if (arg === '--seed') {
            options.seed = requireValue(arg, argv[++i]);
        } else if (arg.startsWith('--seed=')) {
            options.seed = requireValue('--seed', arg.slice('--seed='.length));
        } else if (arg === '--report') {
            options.report = requireValue(arg, argv[++i]);
        } else if (arg.startsWith('--report=')) {
            options.report = requireValue('--report', arg.slice('--report='.length));
        } else if (arg === '--coverage') {
            options.coverage = true;
        } else if (arg === '--list') {
            options.list = true;
        } else if (arg === '--verbose') {
            options.verbose = true;
        } else if (arg === '--help' || arg === '-h') {
            options.help = true;
        } else {
            throw new Error(`Unknown argument: ${arg}`);
        }
    }
    return options;
}
