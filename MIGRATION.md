# GroupWorld runtime synchronization

Source: GroupDirector `852eb1e83e90ecb4a6901178cddb99b420b80bd2`.

This synchronization brings the runtime persistence, cancellation, concurrency,
and test-platform fixes into GroupWorld. The old combined historical regression
files are replaced by the source repository's focused regression tests.

## Compatibility

- Keep `group-director` settings and chat metadata keys, the
  `groupDirector_Interceptor` entry point, DOM identifiers, Provider IDs,
  template syntax, and interchange schemas unchanged.
- Use Group World display names and repository links, and the
  `group-world-default` preset. Prefer the GroupWorld installation directory
  while retaining the GroupDirector directory fallback.
- NPC and character-profile preset URLs use the GroupWorld installation path.
- Preserve the GroupWorld bilingual README structure and existing icon/avatar.
- Only one of GroupWorld and GroupDirector should be enabled at a time: they
  share settings keys, global entry points, and UI identifiers.
- Acorn is a development-only test dependency. Run `npm ci` before tests;
  the installed extension does not require a build or Acorn at runtime.

## Verification

Run `npm run test:full`. The optional real-host event contract requires
`--st-root` or `GD_TEST_ST_ROOT`. Browser automation is not part of this migration.

Verified on Windows / Node 24.12.0:

- Static validation: 316 source files and 11 JSON files passed.
- Behavior tests: 649 total, 648 passed, 1 optional real-host contract skipped,
  0 failed.
- Historical regression contracts: 17/17 passed.
- Source comparison: no unexpected differences after applying the documented
  branding and path substitutions; bilingual READMEs are intentionally retained.
- Local report: `test-results/migration-full.json` (ignored by Git).

These checks do not constitute a browser acceptance run or an upgrade test
against an existing user's live chat data.
