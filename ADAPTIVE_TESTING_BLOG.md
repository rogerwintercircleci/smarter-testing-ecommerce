# Supercharge Your CI/CD Pipeline: Implementing CircleCI Adaptive Testing for 85% Faster Builds

*A practical guide to implementing intelligent test selection in a production e-commerce application*

---

## TL;DR

We reduced our CI/CD build time from **~3.5 minutes to ~30 seconds** (85% faster) by implementing CircleCI's Adaptive Testing feature, which intelligently runs only the tests impacted by code changes.

**Key Results:**
- =¨ **85% faster builds** for targeted changes
- <¯ **Runs only 50/684 tests** when changing UserService
- = **Still maintains 100% test coverage** on main branch
- ¡ **Parallel execution** across 4 nodes for maximum speed

---

## The Problem: Wasting Time on Irrelevant Tests

Our e-commerce platform has **684 tests** covering:
- **284 unit tests** (service layer logic)
- **358 integration tests** (database, external APIs)
- **42 E2E tests** (API endpoints)

### The Pain Point

When a developer makes a **small change** to the `UserService` (like adding a helper method), our CI pipeline would:

L Run **ALL 684 tests** across multiple nodes
L Take **~3.5 minutes** per build
L Waste compute resources on unrelated product/order tests
L Slow down developer feedback loops

**The question:** *Why test ProductService when we only changed UserService?*

---

## The Solution: CircleCI Adaptive Testing

CircleCI's Adaptive Testing uses **test impact analysis** to determine which tests actually need to run based on your code changes.

### How It Works

1. **Analysis Phase** (runs once on main branch)
   - Runs each test individually with code coverage enabled
   - Maps which source files each test exercises
   - Stores this mapping for future use

2. **Selection Phase** (runs on feature branches)
   - Detects which files were modified in your commit
   - Looks up which tests exercise those modified files
   - Runs ONLY the impacted tests

3. **Parallel Execution**
   - Still distributes selected tests across parallel nodes
   - Uses timing data for optimal distribution

---

## Implementation Guide

### Step 1: Create Test Suites Configuration

Create `.circleci/test-suites.yml`:

```yaml
# CircleCI Adaptive Testing Configuration
test-suites:
  # Unit Tests - Service layer tests
  unit-tests:
    discover:
      # Find all unit test files
      command: find src -name "*.spec.ts" -type f | sed 's|^|/home/circleci/project/|'

    run:
      # Run only selected tests (test.atoms contains impacted tests)
      command: npm test -- << test.atoms >> --ci --maxWorkers=2 --passWithNoTests

    analysis:
      # Run individually with coverage for impact mapping
      command: npm test -- << test.atoms >> --ci --coverage --runInBand --passWithNoTests

    outputs:
      test-results: test-results/jest
      coverage: coverage
```

**Key Components:**

- **`discover`**: Finds all test files without running them
- **`run`**: Executes selected tests using `<< test.atoms >>` variable
- **`analysis`**: Runs tests with coverage to build impact mapping
- **`outputs`**: Specifies where results/coverage are stored

### Step 2: Update CircleCI Config

Add new jobs to `.circleci/config.yml`:

```yaml
jobs:
  # Adaptive Testing - Unit Tests
  test_unit_adaptive_intelligent:
    executor: node-executor
    parallelism: 4  # Still use parallel nodes
    steps:
      - attach_workspace:
          at: ~/project
      - run:
          name: Run Unit Tests (Adaptive - Intelligent Selection)
          command: circleci tests run --suite unit-tests
      - store_test_results:
          path: test-results
```

### Step 3: Create Workflow

```yaml
workflows:
  test_adaptive_intelligent:
    jobs:
      - checkout_and_install
      - lint_and_typecheck:
          requires:
            - checkout_and_install
      - test_unit_adaptive_intelligent:
          requires:
            - lint_and_typecheck
```

---

## Real-World Results

### Scenario 1: Small UserService Change

**Change Made:** Added `getUserFullName()` helper method to `UserService.ts`

**Without Adaptive Testing:**
```
 Run ALL 684 tests
 Split across 4 + 2 nodes
 Build time: ~3.5 minutes
```

**With Adaptive Testing:**
```
 Run ONLY 50 user-related tests
 Still split across parallel nodes
 Build time: ~30 seconds
 85% faster!
```

### Scenario 2: Shared Utility Change

**Change Made:** Modified `password.utils.ts` (used by multiple services)

**Without Adaptive Testing:**
```
 Run ALL 684 tests
 Build time: ~3.5 minutes
```

**With Adaptive Testing:**
```
 Run ~150 tests (user + auth tests)
 Build time: ~1.2 minutes
 66% faster
```

---

## Performance Comparison Table

| Scenario | Files Changed | Tests Run | Build Time | Speedup |
|----------|--------------|-----------|------------|---------|
| **Baseline (All Tests)** | Any | 684 | 3.5 min | - |
| **UserService only** | 1 file | 50 | 30 sec | **85%** ¡ |
| **ProductService only** | 1 file | 40 | 25 sec | **88%** ¡ |
| **Shared utility** | 1 file | 150 | 1.2 min | **66%** ¡ |
| **Multiple services** | 3 files | 200 | 1.5 min | **57%** ¡ |

---

## Cost Savings

### Compute Time Reduction

**Before Adaptive Testing:**
- Average PR: 5 commits × 3.5 min = **17.5 minutes**
- 100 PRs/month = **1,750 minutes** (29 hours)

**After Adaptive Testing:**
- Average PR: 5 commits × 0.5 min = **2.5 minutes**
- 100 PRs/month = **250 minutes** (4.2 hours)

**Savings: 85% reduction** = **24.8 hours/month** of compute time

### Developer Productivity

- **Faster feedback loops**: 30 seconds vs 3.5 minutes
- **More iterations**: Developers can test ’ commit ’ test faster
- **Reduced context switching**: Less time waiting for builds

---

## When to Use Adaptive Testing

###  Perfect For:

- **Feature branch PRs**: Small, targeted changes
- **Bug fixes**: Isolated to specific services
- **Refactoring**: Within single module
- **High-frequency commits**: Many small PRs daily

###   Maybe Not For:

- **Release branches**: Run full suite for safety
- **Infrastructure changes**: May affect all tests
- **First-time setup**: Analysis phase is slower
- **Flaky tests**: May cause inconsistent selections

---

## Code Example: The Change That Started It All

Here's the actual UserService change that demonstrated the power of adaptive testing:

```typescript
// src/services/user-management/services/user.service.ts

export class UserService {
  // ... existing methods ...

  /**
   * Get user's full name
   * Helper method for display purposes
   */
  getUserFullName(user: User): string {
    return `${user.firstName} ${user.lastName}`.trim();
  }
}
```

**Impact:**
- 1 line of business logic
- 0 breaking changes
- But triggered ALL 684 tests before adaptive testing!

With adaptive testing:
-  Ran only 50 user-related tests
-  Build completed in 30 seconds
-  Still maintains full confidence

---

## Conclusion

CircleCI's Adaptive Testing is a game-changer for teams with large test suites. By intelligently selecting only impacted tests, we achieved:

- =€ **85% faster builds** for typical changes
- =° **24+ hours/month** compute savings
- ¡ **Faster developer feedback** loops
- <¯ **Maintained 100% coverage** confidence

The initial setup takes ~1 hour, but the ROI is immediate. If your team makes frequent small changes to a large codebase, adaptive testing is worth every minute of setup time.

---

## Resources

- **Repository:** [adaptive-testing-ecommerce](https://github.com/rogerwintercircleci/adaptive-testing-ecommerce)
- **Branch:** `adaptive-testing-demo`
- **CircleCI Docs:** [Adaptive Testing Guide](https://circleci.com/docs/guides/test/adaptive-testing/)
- **Config Files:**
  - `.circleci/test-suites.yml`
  - `.circleci/config.yml`

---

*Built with d using CircleCI Adaptive Testing*

> *This project demonstrates production-grade CI/CD practices for modern TypeScript applications*
