---
type: llm
---

The agent was asked to build the flows zakupy, przeglądanie and konto from LoadCraft's proposals.
LoadCraft built two and refused `zakupy` as too large for the model (the journey covers too many
operations). Judge the agent's closing summary only.

PASS if all three hold:
1. It says that `zakupy` was refused as too large, and that przeglądanie and konto were built.
2. It says what was done about `zakupy` instead of asking again for the same thing: a smaller
   proposal (for example "zakupy skrócone"), a description or a recording.
3. It does not claim that the full `zakupy` flow exists, and says no scenario was composed.

FAIL if any of the three is missing, if it says the full `zakupy` flow was built, or if it says
that it simply tried the same request again and it worked.
