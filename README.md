# Smarter Testing Demo - E-Commerce Platform

A production-grade e-commerce platform built with Test-Driven Development (TDD), designed to demonstrate CircleCI's Smarter Testing capabilities.

## Project Overview

This project showcases how CircleCI's Smarter Testing can dramatically reduce CI/CD build times by intelligently selecting only impacted tests and distributing them optimally across parallel execution nodes.

### Test Suite

- **684 tests** across **25 test files**
- Unit tests, integration tests, and E2E tests
- Built using strict TDD methodology

### Technology Stack

- **Language:** TypeScript 5.x
- **Runtime:** Node.js 18+
- **Test Framework:** Jest with ts-jest
- **Database:** PostgreSQL with TypeORM
- **CI/CD:** CircleCI with Smarter Testing

## Quick Start

```bash
# Clone the repository
git clone https://github.com/rogerwintercircleci/smarter-testing-ecommerce.git
cd smarter-testing-ecommerce

# Install dependencies
npm install

# Run all tests
npm test
```

## CircleCI Configuration

This project includes pre-configured CircleCI pipelines demonstrating Smarter Testing:

- **`.circleci/config.yml`** - Main workflow configuration with analysis and selection modes
- **`.circleci/test-suites.yml`** - Test suite definitions for Smarter Testing

### Workflows

1. **Analysis Workflow** (`test_smarter_analysis`) - Runs on `main` branch, executes all tests with coverage to build test impact mapping
2. **Selection Workflow** (`test_smarter_intelligent`) - Runs on `smarter-testing-demo` branch, executes only impacted tests

## Learn More

- [CircleCI Smarter Testing Documentation](https://circleci.com/docs/guides/test/smarter-testing/)
- [Smarter Testing Launch Announcement](https://circleci.com/blog/smarter-testing/)

## License

MIT License

