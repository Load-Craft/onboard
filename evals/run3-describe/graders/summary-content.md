---
type: llm
---

The agent was asked to build the flows of a load test in LoadCraft from a description walked by
the LoadCraft browser, and stop there, with a short summary for the user, in Polish. Judge that
closing summary only.

PASS if all three hold:
1. It says three flows were recorded by the LoadCraft browser from the user's description:
   `zakupy`, `przeglądanie` and `konto`, with the plan the browser followed.
2. It gives the live-view link of the run or the links of the saved flows, as returned by the
   tool, and does not mention any password or the content of `.env.perf`.
3. It says no scenario was composed and no test was run yet.

FAIL if any of the three is missing, if it names a password or token, or if it claims a test ran.
