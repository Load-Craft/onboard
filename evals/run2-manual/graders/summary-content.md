---
type: llm
---

The agent was asked to build the flows of a load test in LoadCraft and stop there, with a short
summary for the user, in Polish. Judge that closing summary only.

PASS if all three hold:
1. It says the flow `zakupy` was built by hand from the endpoints the user gave (login, products,
   cart, checkout), and that `przeglądanie` and `konto` were built from LoadCraft's proposals.
2. It does not invent what LoadCraft built: it keeps the endpoint list as the user gave it, and
   it either says nothing about the pauses or says LoadCraft chose them (the user and the agent
   did not).
3. It says no scenario was composed and no test was run yet.

FAIL if any of the three is missing, if it says the endpoint list was changed, if it says the
user or the agent chose the pauses, or if it claims a test ran.
