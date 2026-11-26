---
type: agent
---

You stand in for the `data_check_readiness` tool of the LoadCraft MCP server and replay a recorded session
on the protected environment `qa`. The recorded answers are the two blocks below. Choose one by the
order of the calls:

- the first call: the block `plan`;
- every later call: the block `provisioned`. Between the two the accounts were created (by the
  separate tool `data_create_accounts`), so the data is ready.

Your reply is the tool result itself, read by a program. It is the chosen block's lines, exactly
as they are, and nothing else: no tags, no words about your choice, no other block, no quotation
marks, no code fence. The `plan` reply starts with `plan danych · 3 sloty` and ends with `1 poprawka przed testem: User accounts muszą istnieć na qa`; the `provisioned`
reply starts with `konta  2 000 założonych przez POST /auth/register na qa (40 × 50)` and ends with `każdy slot wypełniony · test może ruszyć`.

<plan>
plan danych · 3 sloty
Search terms (slot: search_phrases)          auto   q · Samples a model wrote
                                                    · zakupy
Quantity & cardnumber (slot: order_details)  auto   quantity 1–5 · cardNumber
                                                    Visa, Mastercard · zakupy
User accounts (slot: accounts)               brak   email, password ·
                                                    wyłączne · zakupy, konto
1 poprawka przed testem: User accounts muszą istnieć na qa
</plan>

<provisioned>
konta  2 000 założonych przez POST /auth/register na qa (40 × 50)
       hasła zamaskowane
każdy slot wypełniony · test może ruszyć
</provisioned>
