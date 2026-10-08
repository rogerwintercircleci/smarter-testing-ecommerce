# Smarter Testing demo: test impact analysis and dynamic test splitting with Jest

This repo is the companion project for the CircleCI tutorial on [Smarter Testing](https://circleci.com/docs/guides/test/getting-started-with-smarter-testing/). It's a TypeScript e-commerce API with two Jest test suites:

| Suite | Files | What it tests | Runs where |
|---|---|---|---|
| Unit | `src/**/*.spec.ts`, `tests/workflows/` | Services and libraries, with collaborators mocked | Anywhere, in seconds |
| Integration | `tests/integration/` | Repositories and services against a real PostgreSQL database | Locally with Docker; in CI with a Postgres service container |

The `main` branch is the tutorial's **starting point**: CI runs plain `npx jest`. You'll convert it, step by step, to:

- **test impact analysis**, which runs only the tests a change affects and tells you why each one was picked
- **dynamic test splitting**, which balances the selected tests across parallel nodes while they run

The finished files are in [`solution/`](solution/). The `tutorial-complete` tag shows the repo after the last step.

> **Cost note.** Test impact analysis and dynamic test splitting are paid Smarter Testing features, billed on stored test results, with a free allowance on every plan. Running `circleci testsuite` with `--local` (all of the `npm run demo:*` scripts) uses data on your machine and sends nothing to CircleCI. Use a personal organization on the Free plan to follow along in CI, and check [pricing](https://circleci.com/pricing/) for your plan's allowance.

## Prerequisites

- Node.js 22+
- [CircleCI CLI](https://cli.circleci.com/) v1, logged in with `circleci auth login`
- Docker, only for running the integration suite locally

## Checklist

Each step matches a section of the tutorial.

- [ ] **Fork and build.** Run `gh repo fork rogerwintercircleci/smarter-testing-ecommerce --clone`, then `npm ci` and `circleci project follow`. The first build is your baseline. *(5 min)*
- [ ] **Step 1: Define the suites.** Run `circleci extension install testsuite`, create `.circleci/test-suites.yml`, and run `circleci testsuite doctor "unit tests"`. Every check should pass. *(5 min)*
- [ ] **Step 2: Switch CI to `circleci testsuite run`.** Update `.circleci/config.yml` and push to `main`. The Tests tab counts match the baseline. *(5 min)*
- [ ] **Step 3: Turn on test impact analysis.** Add the coverage plugin and the `analysis` command, run `doctor` again, and push to `main`. *(10 min)*
- [ ] **Step 4: Preview selection locally.** Run `npm run demo:analyze`, then the scenarios below. Compare your output with [`expected/`](expected/). *(10 min)*
- [ ] **Step 5: Watch it select in CI.** Once `main` is green, run `git push -u origin demo/shared`, then try `demo/leaf`. *(5 min)*
- [ ] **Step 6: Turn on dynamic test splitting.** Add `dynamic-test-splitting: true` to the integration suite, push to `main`, and open the job's Timing tab. *(5 min)*

### Scenarios

| Command | What it changes |
|---|---|
| `npm run demo:leaf` | One error message in the user service |
| `npm run demo:shared` | The base error class every service uses |
| `npm run demo:new-test` | Adds a new test file |
| `npm run demo:config` | `jest.config.js`, which triggers a full run |
| `npm run demo:coverage-gap` | An enum member; coverage can't see it, so the type check catches it |
| `npm run demo:reset` | Deletes the `demo/*` branches |

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
| `.circleci/config.yml` | Pipeline: lint and type check, unit tests, integration tests |
| `jest.shared.js` | Jest settings shared by both suites |
| `jest.config.js`, `jest.integration.config.js` | Per-suite Jest config |
| `solution/` | Finished `.circleci/config.yml`, `.circleci/test-suites.yml`, and `jest.shared.js` |
| `scripts/demo.sh` | The scenario scripts behind `npm run demo:*` |
| `expected/` | Scenario output, for comparison |

## Turning it off

Delete the `test-impact-analysis` and `dynamic-test-splitting` lines from `.circleci/test-suites.yml`. `circleci testsuite run` keeps working with free features: static timing-based splitting and rerunning failed tests. You can also go back to `npx jest` at any point.

## License

MIT
