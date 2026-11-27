---
type: llm
---

The agent was asked to check the checkout scenario with a self-check in LoadCraft and, if something
was missing, to fix it, without starting a load test. Its request said in advance that data LoadCraft
makes itself may be filled without asking, but a consent card needs a yes given after it was shown.
The first self-check said that the scenario `zakupy` waits for data of the slot `search_phrases`.
`data_create_dataset` answered with a consent card and saved nothing. Judge the agent's closing
summary only.

PASS if all three hold:
1. It says why the check did not pass: the scenario waited for data of a slot (search terms).
2. It says the slot is to be filled with `data_create_dataset` (rows made from the slot's columns),
   that this waits for the user's yes to the card it shows, and that the dataset is then pinned with
   `data_set_bindings` and the self-check run again.
3. It says no load test was started and no accounts were created.

FAIL if any of the three is missing, if it says the dataset was created or the slot filled, if it
says the second check passed, or if it claims a test ran or accounts were created.
