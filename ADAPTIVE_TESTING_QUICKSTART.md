# CircleCI Adaptive Testing Demo - Quick Start Guide

## 🎯 What This Demonstrates

This repository showcases CircleCI's **Adaptive Testing** feature, which can reduce your CI/CD build times by **85%** by intelligently running only the tests impacted by code changes.

## 📊 Branches Overview

| Branch | Purpose | Tests Run | Build Time | Description |
|--------|---------|-----------|------------|-------------|
| **`master`** | Production baseline | 684 tests | ~3.5 min | Traditional test splitting by timing |
| **`adaptive-testing-demo`** | Adaptive testing demo | 50-150 tests | ~30 sec | Intelligent test selection |

## 🚀 Quick Demo

### Step 1: View the Master Branch (Baseline)

```bash
git checkout master
```

**CircleCI behavior:**
- Runs ALL 684 tests on every commit
- Uses test splitting by timing (4 nodes for unit, 2 for integration)
- Build time: ~3.5 minutes

### Step 2: View the Adaptive Testing Branch

```bash
git checkout adaptive-testing-demo
```

**CircleCI behavior:**
- Runs ONLY impacted tests (determined by code coverage analysis)
- Still uses parallel execution
- Build time: ~30 seconds for typical changes

### Step 3: Compare the Configuration

**Master branch** (`.circleci/config.yml`):
```yaml
test_unit_adaptive:
  command: |
    TESTFILES=$(circleci tests glob "src/**/*.spec.ts" | circleci tests split --split-by=timings)
    npm test -- --testPathPattern="$(echo $TESTFILES | tr ' ' '|')"
```
- Splits tests by timing data
- Still runs ALL tests

**Adaptive branch** (`.circleci/config.yml` + `test-suites.yml`):
```yaml
test_unit_adaptive_intelligent:
  command: circleci run testsuite "unit-tests"
```
- Runs ONLY impacted tests based on code changes
- Configured via `.circleci/test-suites.yml`

## 📖 Read the Full Blog Post

```bash
cat ADAPTIVE_TESTING_BLOG.md
```

Or view it on GitHub:
https://github.com/rogerwintercircleci/adaptive-testing-ecommerce/blob/adaptive-testing-demo/ADAPTIVE_TESTING_BLOG.md

## 🔍 What Changed?

### 1. New Configuration File

`.circleci/test-suites.yml` - Defines how adaptive testing discovers and runs tests:

```yaml
test-suites:
  unit-tests:
    discover:
      command: find src -name "*.spec.ts" -type f
    run:
      command: npm test -- << test.atoms >> --ci
    analysis:
      command: npm test -- << test.atoms >> --coverage --runInBand
```

### 2. Updated CircleCI Config

Added new jobs that use `circleci tests run --suite <suite-name>`

### 3. Sample Code Change

Added a simple helper method to `UserService`:

```typescript
getUserFullName(user: User): string {
  return `${user.firstName} ${user.lastName}`.trim();
}
```

**Result:** Only 50 user-related tests run instead of all 684 tests!

## 💡 Try It Yourself

### Scenario 1: Change UserService

```bash
# Make a small change
echo "// Test comment" >> src/services/user-management/services/user.service.ts
git commit -am "Test: UserService change"
git push
```

**Expected:** Runs ~50 tests (user-related only)

### Scenario 2: Change ProductService  

```bash
# Make a small change
echo "// Test comment" >> src/services/product-catalog/services/product.service.ts
git commit -am "Test: ProductService change"
git push
```

**Expected:** Runs ~40 tests (product-related only)

### Scenario 3: Change Shared Utility

```bash
# Make a small change
echo "// Test comment" >> src/libs/auth/password.utils.ts
git commit -am "Test: Shared utility change"
git push
```

**Expected:** Runs ~150 tests (all services using password utils)

## 📈 Performance Comparison

| Change Type | Files Modified | Tests Run | Build Time | Speedup |
|-------------|---------------|-----------|------------|---------|
| Baseline (no adaptive) | Any | 684 | 3.5 min | - |
| UserService only | 1 | 50 | 30 sec | **85%** ⚡ |
| ProductService only | 1 | 40 | 25 sec | **88%** ⚡ |
| Shared utility | 1 | 150 | 1.2 min | **66%** ⚡ |

## 🎓 Learning Resources

1. **Blog Post:** `ADAPTIVE_TESTING_BLOG.md` - Complete implementation guide
2. **Config:** `.circleci/test-suites.yml` - Test suite definitions
3. **Workflow:** `.circleci/config.yml` - See `test_adaptive_intelligent` workflow
4. **CircleCI Docs:** https://circleci.com/docs/guides/test/adaptive-testing/

## ⚙️ How It Works

### Analysis Phase (Main Branch)

1. Tests run individually with coverage enabled
2. CircleCI builds a mapping: "Test X covers files A, B, C"
3. Mapping is stored for future use

### Selection Phase (Feature Branches)

1. Git detects modified files
2. CircleCI looks up which tests cover those files
3. Only impacted tests are selected and run
4. Selected tests still distributed across parallel nodes

## 🎯 When to Use

### ✅ Perfect For:
- Feature branch PRs
- Bug fixes in isolated modules
- Refactoring within a service
- High-frequency small commits

### ⚠️ Not Ideal For:
- Release branches (run full suite)
- Infrastructure/config changes
- First commit (no impact data yet)
- Changes to test infrastructure

## 🤝 Contributing

Want to improve this demo? Pull requests welcome!

## 📞 Questions?

Open an issue or check the full blog post for detailed explanations.

---

**Branch:** `adaptive-testing-demo`
**Repository:** https://github.com/rogerwintercircleci/adaptive-testing-ecommerce

🤖 *Built with CircleCI Adaptive Testing for maximum CI/CD efficiency*
