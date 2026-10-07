/**
 * Lint config for the integration suite.
 *
 * The root config ignores tests/** and type-checks against tsconfig.json,
 * which excludes tests. Lint this directory with:
 *
 *   npx eslint --no-ignore tests/integration --ext .ts
 *
 * and typed rules resolve against the tsconfig next to this file.
 */
module.exports = {
  parserOptions: {
    project: './tsconfig.json',
    tsconfigRootDir: __dirname,
  },
};
