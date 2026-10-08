#!/usr/bin/env bash
# Run a Smarter Testing scenario on your laptop.
#
#   scripts/demo.sh analyze      build local impact data for the unit suite (run once, on main)
#   scripts/demo.sh <scenario>   make a change on a demo/<scenario> branch and preview selection
#   scripts/demo.sh reset        delete demo branches and return to main
#
# Scenarios: leaf, shared, new-test, config, coverage-gap, flaky
#
# Everything here uses --local: impact data stays in .circleci/ on your machine
# and nothing is sent to CircleCI.
set -euo pipefail

SUITE="unit tests"
cd "$(git rev-parse --show-toplevel)"

preview() {
  echo
  echo "▶ circleci testsuite run \"$SUITE\" --local --run-tests=impacted --analyze-tests=none"
  echo
  local log
  log="$(circleci testsuite run "$SUITE" --local --run-tests=impacted --analyze-tests=none 2>&1 \
    | sed 's/\x1b\[[0-9;]*[A-Za-z]//g')" || true
  # Selection report from Smarter Testing
  grep -E '^(Selecting|Found test|Using|- [0-9]|Selected|Running [0-9]|Rerunning|Reran)' <<<"$log"
  # Which files Jest ran, and the result
  { grep -oE '(PASS|FAIL) +[^ ]+\.ts' <<<"$log" || true; } | sort -u | sed 's/^/  /'
  { grep -oE 'Tests: +[0-9a-z, ]+total' <<<"$log" || true; } | tail -1 | sed 's/^/  /'
}

start_branch() {
  git diff --quiet && git diff --cached --quiet || {
    echo "Commit or stash your changes first." >&2; exit 1; }
  git switch --quiet main
  git switch --quiet -C "demo/$1"
}

commit() {
  git add -A
  git commit --quiet -m "demo: $1"
  echo "Committed on branch demo/$1. To see the same selection in CircleCI:"
  echo "  git push -u origin demo/$1"
}

case "${1:-}" in
  analyze)
    git switch --quiet main
    circleci testsuite run "$SUITE" --local --run-tests=none --analyze-tests=all 2>&1 \
      | grep -E '^(Discovered|Analyzed)'
    ;;
  leaf)
    start_branch leaf
    sed -i.bak 's/Account has been deleted/This account has been deleted/' \
      src/services/user-management/services/user.service.ts
    rm -f src/services/user-management/services/user.service.ts.bak
    commit leaf
    preview
    ;;
  shared)
    start_branch shared
    cat >> src/libs/errors/base.error.ts <<'TS'

/** Error codes clients can rely on, keyed by HTTP status. */
export const ERROR_CODES: Record<number, string> = {
  400: 'BAD_REQUEST',
  401: 'UNAUTHORIZED',
  404: 'NOT_FOUND',
};
TS
    commit shared
    preview
    ;;
  new-test)
    start_branch new-test
    cat > src/libs/validation/pagination.spec.ts <<'TS'
import { commonSchemas } from './validator';

describe('pagination schema', () => {
  it('defaults to page 1 with 20 items', () => {
    expect(commonSchemas.pagination.parse({})).toEqual({ page: 1, limit: 20 });
  });

  it('rejects page sizes over 100', () => {
    expect(() => commonSchemas.pagination.parse({ limit: 500 })).toThrow();
  });
});
TS
    commit new-test
    preview
    ;;
  config)
    start_branch config
    sed -i.bak 's/testTimeout: 30000/testTimeout: 20000/' jest.config.js
    rm -f jest.config.js.bak
    commit config
    preview
    ;;
  coverage-gap)
    start_branch coverage-gap
    # Remove an enum member. Code that uses it no longer compiles, but enum
    # definitions run when the module loads, outside any test, so coverage
    # never links this file to the tests that depend on it.
    sed -i.bak "/APPROVED = 'approved',/d" src/services/order-processing/entities/refund.entity.ts
    rm -f src/services/order-processing/entities/refund.entity.ts.bak
    commit coverage-gap
    preview
    echo
    echo "▶ npm run typecheck   (the CI job that catches what coverage can't see)"
    npm run --silent typecheck || true
    ;;
  flaky)
    start_branch flaky
    # A simulated flaky test: it fails on its first attempt in each run and
    # passes when retried, like a test with a timing or ordering problem.
    cat > tests/workflows/simulated-flake.workflow.test.ts <<'TS'
/**
 * Simulated flaky test for the auto rerun demo (npm run demo:flaky).
 * It fails on its first attempt in each run and passes when retried.
 */
import { execSync } from 'child_process';
import { existsSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const revision = process.env.CIRCLE_SHA1 ?? execSync('git rev-parse HEAD').toString().trim();
const marker = join(tmpdir(), `smarter-testing-flake-${revision}`);

describe('simulated flaky test', () => {
  it('passes when retried', () => {
    const firstAttempt = !existsSync(marker);
    writeFileSync(marker, '');
    expect(firstAttempt).toBe(false);
  });
});
TS
    commit flaky
    preview
    ;;
  reset)
    git switch --quiet main
    git branch --list 'demo/*' --format='%(refname:short)' | xargs -r git branch -D
    ;;
  *)
    sed -n '2,12p' "$0" | sed 's/^# \{0,1\}//'
    exit 1
    ;;
esac
