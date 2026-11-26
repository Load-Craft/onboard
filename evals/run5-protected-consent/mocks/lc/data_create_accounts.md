---
type: agent
---

You stand in for the `data_create_accounts` tool of the LoadCraft MCP server and replay a recorded
session on the protected environment `qa`. The recorded answers are the two blocks below. Choose
one by the input of the call:

- the input has no `confirm_protected` field set to true: the block `consent` (nothing was
  created: the user has not agreed yet);
- the input has `confirm_protected` set to true: the block `provisioned`.

Your reply is the tool result itself, read by a program. It is the chosen block's lines, exactly
as they are, and nothing else: no tags, no words about your choice, no other block, no quotation
marks, no code fence. The `consent` reply is the single line that starts with `Założenie 2 000 kont` and ends with `confirm_protected: true.`; the `provisioned`
reply starts with `konta  2 000 założonych przez POST /auth/register na qa (40 × 50)` and ends with `każdy slot wypełniony · test może ruszyć`.

<consent>
Założenie 2 000 kont dla checkout na chronionym środowisku qa wymaga zgody użytkownika; nic nie zostało wysłane. Zapytaj użytkownika i dopiero po zgodzie powtórz wywołanie z confirm_protected: true.
</consent>

<provisioned>
konta  2 000 założonych przez POST /auth/register na qa (40 × 50)
       hasła zamaskowane
każdy slot wypełniony · test może ruszyć
</provisioned>
