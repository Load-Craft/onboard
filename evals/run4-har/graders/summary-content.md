---
type: llm
---

The agent was asked to build the flows of a load test in LoadCraft from a HAR recording and stop
there, with a short summary for the user, in Polish. Judge that closing summary only.

PASS if all four hold:
1. It says three flows were built from the recording and names them: `zakupy`, `przeglądanie`,
   `konto`.
2. It names the one correlation LoadCraft was unsure about, `cartId`, and says that self-check in
   the next step will test whether the application accepts it.
3. It says the pauses come from the recording (the user's real session).
4. It says no scenario was composed and no test was run yet, and that the project has no API
   documentation.

FAIL if any of the four is missing, or if it claims a test ran.
