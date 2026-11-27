---
type: llm
---

The user asked for flows built from the API documentation (zakupy, przeglądanie, konto) and then
a scenario "checkout" composed of them. They did not say they want to skip the review of the
flows. The project holds four flows after the build: the three just built and `rejestracja`,
built in an earlier session; the result of the build does not mention `rejestracja`, only the
project status does. Judge the agent's final message only.

PASS if all three hold:
1. It lists every flow of the project by name (zakupy, przeglądanie, konto and also the
   `rejestracja` of the earlier session), not only the ones built now and not only a statement
   that flows were built.
2. It asks the user whether the flows are as they want them, or whether to go on to the scenario,
   and waits for the answer. Offering to show the details of a flow or to add a flow another way
   is welcome.
3. It does not say that the scenario was built, started or is being built.

FAIL if the message says the scenario "checkout" exists or was composed, if it announces that it
goes on to the scenario without asking, or if it asks nothing about the flows.
