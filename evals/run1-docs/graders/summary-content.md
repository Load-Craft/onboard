---
type: llm
---

The agent ran a LoadCraft load test of the user's repository and closed with a summary for the
user, in Polish. Judge that closing summary only.

PASS if all three hold:
1. It gives the verdict against the user's thresholds: the test failed (LoadCraft reported
   SLA FAILED; p95 above the 400 ms threshold).
2. It names the code version the result applies to: v2.14.0, the release running on perf (a
   commit hash presented as that release also counts).
3. It says the proposed fix is not verified yet: it has to be deployed and the same test run
   again (and compared with this run) before anyone can say it helps.

FAIL if any of the three is missing, if the summary claims the fix solved the problem, or if it
says the test passed.
