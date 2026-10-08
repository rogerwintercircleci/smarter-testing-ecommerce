# Smarter Testing demo: test impact analysis and dynamic test splitting with Jest

This repo is the companion project for the CircleCI tutorial on [Smarter Testing](https://circleci.com/docs/guides/test/getting-started-with-smarter-testing/). It's a TypeScript e-commerce API with two Jest test suites:

| Suite | Files | What it tests | Runs where |
|---|---|---|---|
| `unit tests` | `src/**/*.spec.ts`, `tests/workflows/` | Services and libraries, with collaborators mocked | Anywhere, in seconds |
| `integration tests` | `tests/integration/` | Repositories and services against a real PostgreSQL database | Locally with Docker; in CI with a Postgres service container across 3 parallel nodes |

You'll use it to see how CircleCI:

- **selects only the tests a change affects** (test impact analysis), and explains why each one was picked
- **balances the selected tests across parallel nodes** while they run (dynamic test splitting)

> **Cost note.** Test impact analysis and dynamic test splitting are paid Smarter Testing features, billed on stored test results with a free allowance on every plan. Running `circleci testsuite` with `--local` (all of the `npm run demo:*` scripts) uses data on your machine and sends nothing to CircleCI. Use a personal organization on the Free plan to follow along in CI, and see [pricing](https://circleci.com/pricing/) for your plan's allowance.

## Prerequisites

- Node.js 22+
- [CircleCI CLI](https://circleci.com/docs/guides/toolkit/local-cli/) v1, logged in (`circleci auth login`), with the testsuite extension: `circleci extension install testsuite`
- Docker (only for running the integration suite locally)

## Checklist

Each step matches a section of the tutorial.

- [ ] **Fork and build.** `gh repo fork <this repo> --clone`, then follow the project in CircleCI. The first build is your baseline. *(5 min)*
- [ ] **Validate the suites.** `circleci testsuite doctor "unit tests"`: every check passes. *(2 min)*
- [ ] **Build local impact data.** `npm run demo:analyze` reports `Analyzed 25 tests`. *(1 min)*
- [ ] **Preview selection.** Run each scenario and compare your output with `expected/`. *(10 min)*
  - `npm run demo:leaf`: a one-line change to the user service
  - `npm run demo:shared`: a change to shared error code
  - `npm run demo:new-test`: a brand-new test file
  - `npm run demo:config`: a Jest config change (full run)
  - `npm run demo:blind-spot`: a change coverage can't see, caught by the type check
  - `npm run demo:reset`: delete the `demo/*` branches
- [ ] **See it in CI.** Wait for the `main` build to go green, then `git push -u origin demo/shared`. *(10 min)*
- [ ] **Compare splitting.** Open the integration job's **Timing** tab for a run with and without `dynamic-test-splitting`. *(10 min)*

## Running the tests directly

```bash
npm ci
npm test                        # unit tests

npm run db:up                   # Postgres 16 on localhost:5432
npm run test:integration        # integration tests
npm run db:down
```

## Where things are

| Path | Purpose |
|---|---|
| `.circleci/test-suites.yml` | Smarter Testing suite definitions |
| `.circleci/config.yml` | Pipeline: lint and type check, unit tests, integration tests (parallelism 3) |
| `jest.shared.js` | Jest settings shared by both suites, including the coverage environment and reporters |
| `jest.config.js`, `jest.integration.config.js` | Per-suite Jest config |
| `scripts/demo.sh` | The scenario scripts behind `npm run demo:*` |
| `expected/` | Output from the scenarios, for comparison |

## Turning it off

Delete the `test-impact-analysis` and `dynamic-test-splitting` lines from `.circleci/test-suites.yml`. `circleci testsuite run` keeps working with free features (static timing-based splitting and rerunning failed tests), or you can replace it with `npx jest`.

## License

MIT
