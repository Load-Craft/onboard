// The tests of the skills: the validators, the content of SKILL.md and the references, the packaging
// and the evaluations. They are *.spec.ts so that `claude plugin test` (which collects every
// *.test.ts in the plugin) leaves them alone. Run them from mcp/ with `npm run test:skills`.
export default {
  cacheDir: '../mcp/node_modules/.vite-skills',
  test: {
    environment: 'node',
    include: ['../tests/**/*.spec.ts'],
    testTimeout: 60_000,
  },
};
