import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    // One module graph per worker instead of one per file: ajv, zod and the SDK are compiled once
    // per worker, and the contract snapshot of the fake is parsed once. Tests keep no global state
    // (no vi.mock, no stubbed globals, env and spies are restored); `--isolate` brings the old mode back.
    isolate: false,
    // A guard against a hang, not a measure of speed: what a test waits for is an event (a frame, the
    // end of a process, a clock step), so a busy machine only makes it slower. 5 s (the default) is a
    // wall-clock limit that a loaded machine reaches with nothing wrong.
    testTimeout: 120_000,
    hookTimeout: 120_000,
    // mod/test holds the mod's pure-function tests; they are *.spec.ts so that `claude plugin test`
    // (which collects every *.test.ts in the plugin) leaves them alone.
    include: ['test/**/*.test.ts', 'src/**/*.test.ts', '../mod/test/**/*.spec.ts'],
  },
});
