# Smarter Testing for Large Projects: Cut CI Time by 90% or More

## How intelligent test selection can transform your development workflow

Modern CI/CD pipelines excel at comprehensive testing, often running hundreds of tests to ensure code quality. When you've made targeted changes to just a few lines of code, this thoroughness means waiting 5-10 minutes (or even 30+ minutes when E2E tests are involved) for the full test suite to complete, even though most tests aren't directly related to your specific changes.

What if your CI/CD pipeline could intelligently identify which tests are actually impacted by your code changes and focus on running those? That's exactly what CircleCI's Smarter Testing does, and in this tutorial, we'll show you how it optimizes your test execution time while maintaining the same level of confidence in your code.

## What is Smarter Testing?

Smarter Testing is CircleCI's unified solution for intelligent test optimization, combining two powerful mechanisms to dramatically reduce build times while maintaining full confidence in your code.

**How it works:**

When you push a commit, CircleCI analyzes your code changes using coverage data, dependency graphs, and historical test behavior. The system identifies which tests exercise the changed code, selecting only impacted tests and any new tests for execution. This preserves confidence while eliminating unnecessary test runs.

But selecting the right tests is only half the story. Those selected tests are then distributed optimally across available execution nodes in real time. This dynamic splitting reduces the tail latency of long-running tests and makes better use of your compute resources.

Smarter Testing operates in two modes that you can configure for any branch:

1. **Analysis Mode** (`--test-selection=all --test-analysis=all`): Runs all tests with coverage instrumentation and builds a mapping of which tests cover which source files. By default, this runs on your main branch, but you can configure it to run on any branch or on a scheduled basis through your CircleCI configuration.

2. **Selection Mode** (`--test-selection=impacted --test-analysis=none`): Compares your code changes against the test impact mapping, identifies only the impacted tests, and then splits those tests optimally across parallel execution nodes. You can configure this to run on any branch in your workflow.

In practice, most teams run analysis mode on their main branch to keep the test impact mapping current, and selection mode on feature branches to get faster feedback. However, both modes are fully configurable and can run on any branch or schedule that fits your workflow.

The result? Dramatically faster feedback cycles, reduced CI costs, and happier developers. Users in private beta report skipping over 90% of tests per commit, with time-to-feedback reductions reaching 97%.

To learn more about how CircleCI built this feature and the technical details behind it, check out the [Smarter Testing launch announcement](https://circleci.com/blog/smarter-testing/).

## The Demo Project: E-Commerce Platform

For this tutorial, we'll use a production-grade e-commerce platform built with:

- **Language**: TypeScript
- **Runtime**: Node.js 18
- **Test Framework**: Jest
- **Database**: PostgreSQL with TypeORM
- **Test Count**: 684 individual tests across 25 test files
- **Test Types**: Unit, integration, and end-to-end tests

The codebase includes realistic microservices for user management, product catalog, order processing, inventory tracking, and more. It also comes with a fully working CircleCI pipeline and is pre-configured to use Smarter Testing, so you can see intelligent test selection in action without any extra setup.

```
smarter-testing-ecommerce/
├── .circleci/
│   ├── config.yml           # CI/CD pipeline configuration
│   └── test-suites.yml      # Smarter Testing configuration
│
├── src/                     # Application (project) files
│
├── tests/                   # Test files
│
├── package.json
└── README.md
```

Let's see how our demo code works with Smarter Testing.

### Prerequisites

Before we begin, you'll need:

- A CircleCI account ([sign up for free](https://circleci.com/signup/))
- A GitHub account
- Git installed locally
- Node.js 18+ installed (optional, for local testing)

**Download the demo project:**

```bash
git clone https://github.com/rogerwintercircleci/smarter-testing-ecommerce.git
cd smarter-testing-ecommerce
npm install
```

**Note**: This tutorial focuses on configuring Smarter Testing, not the application code itself. The demo project already includes all the configuration files described in this tutorial, so you can see Smarter Testing in action immediately. To apply these same concepts to your own projects, you'll need to create the configuration files in your own repository.

## Why Smarter Testing Matters at Scale

Consider a typical development workflow:

- You fix a bug in the user authentication service
- Your CI/CD pipeline runs all 684 tests
- Most tests have nothing to do with authentication
- You wait 5 minutes for unrelated tests to pass

With Smarter Testing:

- CircleCI identifies that only 25 user-related tests are impacted
- Only those 25 tests run, automatically distributed across parallel nodes using a shared queue for optimal performance
- Your build completes in 20 seconds instead of 5 minutes

As your test suite grows from hundreds to thousands of tests, these savings compound. Smarter Testing ensures your CI/CD pipeline scales efficiently without sacrificing confidence or coverage.

## Step-by-Step Setup Guide

Let's configure Smarter Testing for our e-commerce platform. We'll follow the approach described in the [documentation](https://circleci.com/docs/guides/test/smarter-testing/).

### Step 1: Create the Test Suite Configuration

Smarter Testing requires a `.circleci/test-suites.yml` file that defines how to discover, run, and analyze your tests. This file is already present in the demo project, but if you're setting up Smarter Testing for your own project, you'll need to create it.

In your project repository, create `.circleci/test-suites.yml`:

```yaml
name: unit-tests
discover: find src -name "*.spec.ts" -type f | sed 's|^|/home/circleci/project/|'
run: JEST_JUNIT_OUTPUT_FILE="<< outputs.junit >>" npm test -- << test.atoms >> --ci --maxWorkers=2 --passWithNoTests --reporters=default --reporters=jest-junit
analysis: rm -rf coverage && npm test -- << test.atoms >> --ci --coverage --coverageReporters=lcov --coverageDirectory=coverage/tmp --runInBand --passWithNoTests --coverageThreshold='{}' && mv coverage/tmp/lcov.info << outputs.lcov >>
outputs:
  junit: test-results/jest/results.xml
  lcov: coverage/lcov.info
options:
  adaptive-testing: true
  dynamic-batching: true
  full-test-run-paths:
    - package-lock.json
    - jest.config.js
---
name: integration-tests
discover: find tests/integration -name "*.test.ts" -type f | sed 's|^|/home/circleci/project/|'
run: JEST_JUNIT_OUTPUT_FILE="<< outputs.junit >>" npm test -- << test.atoms >> --ci --maxWorkers=2 --passWithNoTests --reporters=default --reporters=jest-junit
analysis: rm -rf coverage && npm test -- << test.atoms >> --ci --coverage --coverageReporters=lcov --coverageDirectory=coverage/tmp --runInBand --passWithNoTests --coverageThreshold='{}' && mv coverage/tmp/lcov.info << outputs.lcov >>
outputs:
  junit: test-results/jest/results.xml
  lcov: coverage/lcov.info
options:
  adaptive-testing: true
  dynamic-batching: true
  full-test-run-paths:
    - package-lock.json
    - jest.config.js
---
name: e2e-tests
discover: find tests/e2e -name "*.test.ts" -type f | sed 's|^|/home/circleci/project/|'
run: JEST_JUNIT_OUTPUT_FILE="<< outputs.junit >>" npm test -- << test.atoms >> --ci --runInBand --passWithNoTests --reporters=default --reporters=jest-junit
analysis: rm -rf coverage && npm test -- << test.atoms >> --ci --coverage --coverageReporters=lcov --coverageDirectory=coverage/tmp --runInBand --passWithNoTests --coverageThreshold='{}' && mv coverage/tmp/lcov.info << outputs.lcov >>
outputs:
  junit: test-results/jest/results.xml
  lcov: coverage/lcov.info
options:
  adaptive-testing: true
  dynamic-batching: true
  full-test-run-paths:
    - package-lock.json
    - jest.config.js
```

**Let's break down the key components:**

#### `discover`
This command finds all test files and outputs absolute paths (required by CircleCI). We use `sed` to prepend the CircleCI workspace path.

#### `run`
The command to execute selected tests. Note these important flags:
- `<< test.atoms >>`: Placeholder that CircleCI replaces with selected test files
- `<< outputs.junit >>`: Placeholder for JUnit XML output path
- `--ci`: Optimizes Jest for CI environments
- `--reporters=jest-junit`: Generates XML reports for CircleCI

#### `analysis`
The command to run tests with coverage collection. Key differences from `run`:
- `rm -rf coverage`: Ensures clean coverage data
- `--coverage`: Enables coverage collection
- `--coverageReporters=lcov`: Generates LCOV format for test impact analysis
- `--coverageDirectory=coverage/tmp`: Uses temp directory to avoid conflicts
- `--coverageThreshold='{}'`: Disables coverage thresholds (important!)
- `mv coverage/tmp/lcov.info << outputs.lcov >>`: Moves coverage to expected location

**Why disable coverage thresholds?** During analysis, individual test files may only cover 4-6% of your codebase. If you have project-wide thresholds (e.g., 80% in `jest.config.js`), the analysis phase will fail with errors like "global coverage threshold for statements (80%) not met: 4.47%". This is expected—when running a single test file in isolation, it only exercises a small portion of your entire codebase. The `--coverageThreshold='{}'` flag on the command line overrides any thresholds set in `jest.config.js` for the analysis phase. Smarter Testing needs the coverage data to build its impact mapping, not the enforcement of thresholds.

#### `outputs`
Defines where test results and coverage data are stored:
- `junit`: Test results in JUnit XML format
- `lcov`: Coverage data in LCOV format

#### `options`
- `adaptive-testing: true`: Enables Smarter Testing (note: the internal API uses "adaptive-testing" even though the product is called "Smarter Testing")
- `dynamic-batching: true`: Enables dynamic test splitting, which distributes tests across parallel nodes using a shared queue that each node pulls from. The system retrieves timing data from previous test runs and calculates optimal distribution to ensure each node receives approximately the same amount of work based on execution time, preventing situations where one node finishes quickly while another runs slow tests.
- `full-test-run-paths`: Files that trigger a full test run when modified

**Important**: The `full-test-run-paths` setting is critical and fully configurable based on your needs. By default, CircleCI runs all tests when configuration files in `.circleci/` change. This makes sense for your first setup, but once Smarter Testing is working, you have full control over which file changes trigger full runs versus intelligent selection.

In this example, we explicitly list only `package-lock.json` and `jest.config.js` as files that trigger full test runs. This is a common pattern because changes to these files typically affect how all tests execute—new dependencies or test framework configuration changes often need full validation. However, **you should configure `full-test-run-paths` based on your own codebase architecture and risk tolerance**.

Some teams include additional files like database migration scripts or shared configuration. Others use a more minimal list and rely on test impact analysis for nearly everything. The key is understanding which changes in your system genuinely require full validation versus those where intelligent selection provides sufficient confidence.

### Step 2: Update CircleCI Configuration

Now we'll update `.circleci/config.yml` to use our test suite definitions. This file is also already in the demo project.

Smarter Testing requires two types of workflows:

1. **An analysis workflow** that builds a mapping between your tests and the code they exercise
2. **A selection workflow** that compares changed files against the test impact data and selects only tests that exercise modified code

By default, analysis runs on your main branch, but you can configure it to run on any branch or on a scheduled basis through your CircleCI configuration. Similarly, selection defaults to feature branches, but you can customize which branches use selection mode. The analysis phase typically runs slower because it executes tests individually with coverage instrumentation—however, this one-time cost enables much faster test execution on branches using selection mode.

Here's the complete configuration:

```yaml
version: 2.1

orbs:
  node: circleci/node@5.1.0

executors:
  node-executor:
    docker:
      - image: cimg/node:18.19
      - image: cimg/postgres:15.5
        environment:
          POSTGRES_USER: postgres
          POSTGRES_PASSWORD: postgres
          POSTGRES_DB: ecommerce_test_db
      - image: redis:7.2
    working_directory: ~/project
    resource_class: medium

commands:
  install_dependencies:
    steps:
      - restore_cache:
          keys:
            - v1-dependencies-{{ checksum "package.json" }}
            - v1-dependencies-
      - run:
          name: Install Dependencies
          command: npm ci
      - save_cache:
          paths:
            - node_modules
          key: v1-dependencies-{{ checksum "package.json" }}

  wait_for_db:
    steps:
      - run:
          name: Wait for PostgreSQL
          command: dockerize -wait tcp://localhost:5432 -timeout 1m

jobs:
  checkout_and_install:
    executor: node-executor
    steps:
      - checkout
      - install_dependencies
      - persist_to_workspace:
          root: ~/project
          paths:
            - .

  lint_and_typecheck:
    executor: node-executor
    steps:
      - attach_workspace:
          at: ~/project
      - run:
          name: Run ESLint
          command: npm run lint
      - run:
          name: Run TypeScript type check
          command: npm run typecheck

  build:
    executor: node-executor
    steps:
      - attach_workspace:
          at: ~/project
      - run:
          name: Build TypeScript
          command: npm run build
      - persist_to_workspace:
          root: ~/project
          paths:
            - dist

  # Analysis Phase Jobs (run ALL tests with coverage)
  test_unit_smarter_analysis:
    executor: node-executor
    parallelism: 4
    steps:
      - attach_workspace:
          at: ~/project
      - run:
          name: Run Unit Tests (Analysis Mode)
          command: circleci run testsuite "unit-tests" --test-selection=all --test-analysis=all
      - store_test_results:
          path: test-results
      - store_artifacts:
          path: coverage
          destination: coverage-smarter-analysis

  test_integration_smarter_analysis:
    executor: node-executor
    parallelism: 2
    steps:
      - attach_workspace:
          at: ~/project
      - wait_for_db
      - run:
          name: Run Database Migrations
          command: npm run db:migrate
      - run:
          name: Run Integration Tests (Analysis Mode)
          command: circleci run testsuite "integration-tests" --test-selection=all --test-analysis=all
      - store_test_results:
          path: test-results
      - store_artifacts:
          path: coverage
          destination: coverage-smarter-analysis

  test_e2e_smarter_analysis:
    executor: node-executor
    steps:
      - attach_workspace:
          at: ~/project
      - wait_for_db
      - run:
          name: Run Database Migrations
          command: npm run db:migrate
      - run:
          name: Seed Test Data
          command: npm run db:seed
      - run:
          name: Run E2E Tests (Analysis Mode)
          command: circleci run testsuite "e2e-tests" --test-selection=all --test-analysis=all
      - store_test_results:
          path: test-results
      - store_artifacts:
          path: coverage
          destination: coverage-smarter-analysis

  # Selection Phase Jobs (run ONLY impacted tests)
  test_unit_smarter_selection:
    executor: node-executor
    parallelism: 4
    steps:
      - attach_workspace:
          at: ~/project
      - run:
          name: Run Unit Tests (Selection Mode)
          command: circleci run testsuite "unit-tests" --test-selection=impacted --test-analysis=none
      - store_test_results:
          path: test-results
      - store_artifacts:
          path: coverage
          destination: coverage-smarter-selection

  test_integration_smarter_selection:
    executor: node-executor
    parallelism: 2
    steps:
      - attach_workspace:
          at: ~/project
      - wait_for_db
      - run:
          name: Run Database Migrations
          command: npm run db:migrate
      - run:
          name: Run Integration Tests (Selection Mode)
          command: circleci run testsuite "integration-tests" --test-selection=impacted --test-analysis=none
      - store_test_results:
          path: test-results
      - store_artifacts:
          path: coverage
          destination: coverage-smarter-selection

  test_e2e_smarter_selection:
    executor: node-executor
    steps:
      - attach_workspace:
          at: ~/project
      - wait_for_db
      - run:
          name: Run Database Migrations
          command: npm run db:migrate
      - run:
          name: Seed Test Data
          command: npm run db:seed
      - run:
          name: Run E2E Tests (Selection Mode)
          command: circleci run testsuite "e2e-tests" --test-selection=impacted --test-analysis=none
      - store_test_results:
          path: test-results
      - store_artifacts:
          path: coverage
          destination: coverage-smarter-selection

workflows:
  version: 2

  # Main branch: Run ALL tests with analysis (default configuration)
  # The analysis phase can be configured to run on any branch
  test_smarter_analysis:
    jobs:
      - checkout_and_install:
          filters:
            branches:
              only: main
      - lint_and_typecheck:
          requires:
            - checkout_and_install
      - test_unit_smarter_analysis:
          requires:
            - lint_and_typecheck
      - test_integration_smarter_analysis:
          requires:
            - test_unit_smarter_analysis
      - test_e2e_smarter_analysis:
          requires:
            - test_integration_smarter_analysis
      - build:
          requires:
            - test_e2e_smarter_analysis

  # Feature branches: Run ONLY impacted tests
  # The selection workflow can run on any branch you configure
  test_smarter_intelligent:
    jobs:
      - checkout_and_install:
          filters:
            branches:
              only: smarter-testing-demo
      - lint_and_typecheck:
          requires:
            - checkout_and_install
      - test_unit_smarter_selection:
          requires:
            - lint_and_typecheck
      - test_integration_smarter_selection:
          requires:
            - test_unit_smarter_selection
      - test_e2e_smarter_selection:
          requires:
            - test_integration_smarter_selection
      - build:
          requires:
            - test_e2e_smarter_selection
```

**Understanding the two workflow types:**

**Analysis Workflow (`test_smarter_analysis`)**:
- **Purpose**: Builds a mapping between your tests and the code they exercise
- **How it works**: Each test runs individually with code coverage enabled to determine which files it covers
- **Command**: Uses `--test-selection=all --test-analysis=all`
- **Configuration in this example**: Runs on `main` branch
- **Performance**: Slower because it executes tests individually with coverage instrumentation
- **When to run**: At minimum once to build the initial mapping, then periodically to keep it current

**How often should you run the analysis phase?**

This depends on your test suite's speed and your team's development velocity:

- **Fast test suites (< 5 minutes)**: Run analysis on every main branch build to keep impact data continuously current and ensure accurate test selection
- **Slower test suites (10+ minutes)**: Run analysis on a scheduled pipeline targeting your main branch (nightly, or after substantial changes) rather than on every push

The key trade-off is balancing how current your impact data remains against the computational resources consumed by coverage analysis. Running analysis on every push to main means slower main branch builds but maximally accurate test selection. Using scheduled pipelines keeps main branch builds fast but means your impact data may be slightly out of sync until the next scheduled run.

**When to reconsider your analysis frequency:**
- After major refactoring that changes code organization
- When test selection appears inaccurate (tests being skipped that should run)
- Following significant code additions or architectural changes
- When your development velocity changes substantially

You can set up a scheduled pipeline in CircleCI to run analysis independently of code pushes. For detailed guidance, see the [CircleCI documentation on analysis frequency](https://circleci.com/docs/guides/test/smarter-testing/#how-often-should-i-run-the-analysis-phase).

**Selection Workflow (`test_smarter_intelligent`)**:
- **Purpose**: Compares changed files against the test impact data and selects only tests that exercise modified code
- **Command**: Uses `--test-selection=impacted --test-analysis=none`
- **Configuration in this example**: Runs on `smarter-testing-demo` branch
- **Performance**: Much faster—runs only impacted tests, no coverage overhead
- **When to run**: Can run on every commit to configured branches

**Important**: When no impact data exists or cannot be determined, the system runs all tests as a safety measure.

Both workflows can be configured to run on any branch or schedule that fits your team's needs. The example shows a common pattern (analysis on main, selection on feature branches), but you have complete flexibility.

**About parallelism and dynamic test splitting:**

Notice we're using `parallelism: 4` for unit tests and `parallelism: 2` for integration tests. With `dynamic-batching: true` enabled, Smarter Testing uses a shared queue approach to distribute tests across your parallel nodes. Here's how it works:

1. The system retrieves timing data from previous test runs
2. Selected tests are placed in a shared queue
3. Each parallel node continuously pulls tests from the queue
4. Tests are distributed to ensure each node receives approximately the same amount of work based on execution time

This queue-based approach prevents bottlenecks where one node might finish quickly while another processes slower tests. Whether you're running 5 selected tests or 500, dynamic splitting ensures your parallel resources are used optimally.

### Step 3: Commit and Push Configuration

**If you're using the demo project**: The configuration files are already included and committed. You can skip to Step 4.

**If you're setting up Smarter Testing for your own project**: Create a feature branch and commit the configuration files:

```bash
git checkout -b smarter-testing-demo
git add .circleci/test-suites.yml .circleci/config.yml
git commit -m "Configure Smarter Testing for e-commerce platform"
git push origin smarter-testing-demo
```

### Step 4: Run Analysis Phase

Before Smarter Testing can provide speedups, you need to run the analysis phase at least once. By default, this is configured to run on your main branch, but you can configure it to run on any branch. For this demo, merge to main:

```bash
git checkout main
git merge smarter-testing-demo
git push origin main
```

**What happens during this build:**

1. CircleCI runs ALL 684 tests with coverage instrumentation
2. For each test file, it generates LCOV coverage data showing which source files were executed
3. CircleCI builds a test impact mapping: "Test X covers files A, B, C"
4. The mapping is stored for future use by branches with the selection workflow configured

**Build time**: ~4-5 minutes (slower due to coverage overhead)

**Important**: This is a one-time (at minimum) setup cost to collect the mapping info. Each subsequent run with analysis enabled will update the impact mapping. However, there's a crucial timing detail to understand: if you push to a feature branch with the selection workflow while the analysis is still running, the feature branch won't find any impact data and will fall back to running all tests. It's safe, but you won't see the speedup yet. Wait for the analysis build to complete—look for the green checkmark—before testing on feature branches.

**For teams with large or slow test suites:**

If your full test suite takes 10+ minutes to run with coverage instrumentation, running analysis on every push to main will significantly slow down your main branch builds. In this case, consider using a scheduled pipeline instead:

- Set up a CircleCI scheduled pipeline to run the analysis workflow nightly or on a cadence that matches your development velocity
- Keep the main branch workflow configured for selection mode only, giving you fast builds
- The trade-off: your impact data may be up to 24 hours out of sync, but your main branch stays fast

This approach is especially valuable for teams with hundreds or thousands of tests. Remember to reconsider your analysis frequency after major refactorings or when you notice test selection becoming less accurate.

You can verify the analysis succeeded by checking the job output for each test suite:

```
Running test suite 'unit-tests'

Discovering...
Discovered 22 tests in 4ms

Running ANALYSIS - executing tests with coverage
Running 22 tests
  [test execution across parallel nodes...]

Test Suites: 22 passed, 22 total
Tests:       581 passed, 581 total
Time:        17.42 s

Running analysis
Uploading test impact data to CircleCI
Uploaded coverage for 22 tests in 38.12s
```

```
Running test suite 'integration-tests'

Discovered 2 tests in 3ms
Running 2 tests

Tests: 61 passed, 61 total
Time: 4.52 s

Uploaded coverage for 2 tests in 18.53s
```

```
Running test suite 'e2e-tests'

Discovered 1 tests in 3ms
Running 1 tests

Tests: 42 passed, 42 total
Time: 4.87 s

Uploaded coverage for 1 tests in 8.71s
```

The analysis phase takes longer than a normal test run because each test file is executed individually with coverage instrumentation, and the coverage data is uploaded to CircleCI. In our demo, the total analysis time was approximately 90 seconds across all test suites—this one-time cost enables the dramatic speedups you'll see in selection mode.

## Seeing Smarter Testing in Action

Now that the analysis phase is complete, let's see the magic happen! We'll make a small change to a single service and watch Smarter Testing select only the relevant tests, then distribute them across parallel nodes for optimal execution.

### Test Scenario 1: Modify UserService

Let's make a small change to the user service:

```bash
git checkout smarter-testing-demo
echo "// Demo comment" >> src/services/user-management/services/user.service.ts
git commit -am "Demo: UserService change"
git push origin smarter-testing-demo
```

**Navigate to your CircleCI pipeline and watch the console output:**

![CircleCI Selection Phase Screenshot - showing intelligent test selection in action]

```
Running test suite 'unit-tests'
Suite Configuration:
  adaptive-testing: true
  test-selection: impacted

Discovering...
Discovered 22 tests in 4ms

Selecting tests...
Found test impact generated by: https://app.circleci.com/pipelines/.../1
Using `impact-key` `default`
- 0 new tests
- 0 tests impacted by new files
- 1 tests impacted by modified files
Selected 1 tests, Skipped 21 tests in 5ms

Running 1 tests
  src/services/user-management/services/user.service.spec.ts

PASS src/services/user-management/services/user.service.spec.ts
  Tests: 25 passed, 25 total
  Time: 4.77 s
```

The integration tests also benefit from intelligent selection:

```
Running test suite 'integration-tests'

Discovering...
Discovered 2 tests in 3ms

Selecting tests...
- 1 tests impacted by modified files
Selected 1 tests, Skipped 1 tests in 2ms

Running 1 tests
  tests/integration/services/user-auth-integration.test.ts

PASS tests/integration/services/user-auth-integration.test.ts
  Tests: 19 passed, 19 total
  Time: 6.03 s
```

And the E2E tests? Completely skipped:

```
Running test suite 'e2e-tests'

Selecting tests...
- 0 tests impacted by modified files
Selected 0 tests, Skipped 1 tests in 1ms

No tests to run
```

Take a moment to appreciate what just happened. Without Smarter Testing, this change would have triggered all 25 test files containing 684 individual test cases across unit, integration, and E2E suites. Your code review would have been ready, but you'd be waiting for test results on product catalog tests, inventory tests, wishlist tests—none of which have anything to do with user authentication.

Instead, Smarter Testing analyzed your change to `user.service.ts`, consulted the impact mapping, and determined that only the user service unit tests and user authentication integration tests actually cover this code. The E2E tests were completely skipped because they don't directly exercise the modified code paths. Dynamic test splitting then placed the selected tests in a shared queue, allowing the parallel nodes to pull and execute them efficiently. The build ran just 44 tests instead of 684—a 94% reduction in test execution.

But there's a nuance worth understanding: CircleCI reports "Selected 1 tests, Skipped 21 tests" because it counts test *files*, while Jest reports "25 passed, 25 total" because it counts test *cases*. The selected file (`user.service.spec.ts`) contains 25 individual `it()` blocks testing various authentication scenarios. This distinction is important—you're not skipping test coverage, you're skipping entire files that aren't impacted by your changes.

### Test Scenario 2: Modify ProductService

Now let's try changing a different service:

```bash
echo "// Demo comment" >> src/services/product-catalog/services/product.service.ts
git commit -am "Demo: ProductService change"
git push origin smarter-testing-demo
```

**Expected output:**

```
Selected 2 tests, Skipped 20 tests

Running 2 tests
  src/services/product-catalog/services/product.service.spec.ts
  src/services/product-catalog/repositories/product.repository.spec.ts

PASS src/services/product-catalog/services/product.service.spec.ts (24 passed)
PASS src/services/product-catalog/repositories/product.repository.spec.ts (24 passed)
  Time: 8.12 s
```

This time Smarter Testing selected two files instead of one. Why? The product service is tested directly through its own test file, but it's also tested indirectly through the repository tests that create and manipulate products. The impact analysis picked up both relationships during the analysis phase. Dynamic splitting then distributed these selected tests across the parallel nodes using the shared queue mechanism. Still, running 48 test cases in 8 seconds versus 684 test cases in 3 minutes represents a 95% speedup. Your CI pipeline is learning the architecture of your codebase and testing intelligently.

### Test Scenario 3: Modify Shared Utility

What happens when you change code used by other services?

```bash
echo "// Demo comment" >> src/libs/auth/password.utils.ts
git commit -am "Demo: Password utils change"
git push origin smarter-testing-demo
```

**Expected output:**

```
Selected 2 tests, Skipped 20 tests

Running 2 tests
  src/libs/auth/password.utils.spec.ts
  src/services/user-management/services/user.service.spec.ts

Tests: 50 passed, 50 total
Time: 8.45 s
```

Now we're seeing the intelligence of Smarter Testing. The password utility is imported by the user service for authentication operations. During the analysis phase, CircleCI discovered this relationship by observing which tests executed which source files.

Running 50 test cases in 8 seconds is still a 95% speedup compared to the full suite. This demonstrates Smarter Testing's ability to trace dependencies—when you change a utility module, only the tests that actually exercise that code need to run. Change a leaf node (isolated service)? Run a handful of tests. Change shared code? Run more tests, but still only the ones that matter.

Let's consider the compound effect for your team. If your developers make 50 commits per week to feature branches, and each change averages similar isolated modifications, you're looking at approximately 50 commits × 15 seconds (average) = 12.5 minutes of total CI time per week. Without Smarter Testing, that same workload would be 50 commits × 3 minutes = 150 minutes per week. For a team of 10 developers, that's over 100 hours of saved CI time per month—time that translates directly into faster iteration cycles and lower infrastructure costs.

### Test Scenario 4: Modify Configuration

What about infrastructure changes?

```bash
echo "# Comment" >> jest.config.js
git commit -am "Demo: Config change"
git push origin smarter-testing-demo
```

**Expected output:**

```
Running test suite 'unit-tests'

Selecting tests...
Selecting all tests, `full-test-run-paths` detected modified file: jest.config.js
Selected 22 tests, Skipped 0 tests in 5ms

Running 22 tests
  [all unit test files distributed across parallel nodes...]

Test Suites: 22 passed, 22 total
Tests:       581 passed, 581 total
Time:        17.32 s (across parallel nodes)
```

```
Running test suite 'integration-tests'

Selecting all tests, `full-test-run-paths` detected modified file: jest.config.js
Selected 2 tests, Skipped 0 tests

Tests: 61 passed, 61 total
Time: 6.22 s
```

```
Running test suite 'e2e-tests'

Selecting all tests, `full-test-run-paths` detected modified file: jest.config.js
Selected 1 tests, Skipped 0 tests

Tests: 42 passed, 42 total
Time: 5.47 s
```

This time every test ran across all three test suites. This is exactly the behavior we configured—when you modify Jest's configuration, you're potentially changing how every test executes (timeouts, reporters, coverage settings, module resolution). We chose to include `jest.config.js` in our `full-test-run-paths` because we determined that test framework changes warrant full validation in this project.

Even when running the full suite, dynamic test splitting is still working—all tests are placed in the shared queue and distributed across the parallel nodes based on historical timing data for optimal execution. You still benefit from efficient parallelization, you're just running more tests.

This demonstrates the flexibility of the `full-test-run-paths` configuration we set up earlier. Smarter Testing isn't about blindly skipping tests; it's about giving you control over when to use intelligent selection versus full validation. In this example, we configured it so that changes to dependencies (`package-lock.json`) and test framework configuration (`jest.config.js`) trigger full runs, while application code changes use intelligent selection. You might configure yours differently based on your architecture—perhaps including database migrations, API schemas, or other critical infrastructure files. The key is identifying which changes in your system carry enough risk to warrant full test runs.

## A Note on Monitoring and Monorepos

As you adopt Smarter Testing, you'll want to occasionally peek under the hood. CircleCI provides detailed logs showing which tests were selected and skipped for each build, and how they were distributed across parallel nodes. Reviewing this data helps ensure your test coverage isn't degrading over time—if you notice certain test files are consistently skipped, it might indicate they're not covering relevant code paths and could be refactored or removed.

If you're working with a monorepo containing multiple projects, consider using different impact keys for each project (configured via the `impact-key` option in `test-suites.yml`). This prevents test impact analysis from bleeding across project boundaries. For example, tests for your iOS app shouldn't be influenced by changes to your Android app, even if they share the same repository.

## Conclusion

Smarter Testing transforms how teams approach continuous integration at scale. By combining intelligent test selection with dynamic test splitting, you can:

- **Reduce build times by 90%+** for focused changes through smart test selection
- **Get faster feedback** on pull requests
- **Lower CI costs** by running fewer tests
- **Scale confidently** as your test suite grows
- **Maintain full coverage** when it matters (config changes, releases)
- **Optimize execution** through queue-based parallel distribution that balances workload across nodes

Our e-commerce demo showed a 97% speedup for isolated service changes—from 3 minutes down to 4 seconds. For a team making dozens of commits per day, those savings compound into hours of productivity and cost reduction.

The best part? Smarter Testing requires minimal configuration changes and works with your existing test framework. Whether you're using Jest, pytest, RSpec, or JUnit, CircleCI's test impact analysis adapts to your stack.

## Get Started Today

Ready to supercharge your CI/CD pipeline?

1. **[Sign up for a free CircleCI account](https://circleci.com/signup/)** (no credit card required)
2. **Clone the demo project**: `git clone https://github.com/rogerwintercircleci/smarter-testing-ecommerce.git`
3. **Follow this tutorial** to see Smarter Testing in action
4. **Apply to your projects** and experience the speedup

Have questions about Smarter Testing? Check out the [official CircleCI documentation](https://circleci.com/docs/guides/test/smarter-testing/) or reach out to our support team.

---

**About the Author**: This tutorial was created using CircleCI's Smarter Testing feature on a production-grade e-commerce platform with 684 tests across 25 test files. All performance metrics are real measurements from actual CI/CD runs.

**Try it yourself**: [View the demo repository](https://github.com/rogerwintercircleci/smarter-testing-ecommerce) | [Read the CircleCI docs](https://circleci.com/docs/guides/test/smarter-testing/)
