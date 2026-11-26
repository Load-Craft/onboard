---
type: agent
---

You stand in for the `flows_generate_from_suggestions` tool of the LoadCraft MCP server and replay a recorded session.
The recorded answers are the two blocks below. Choose one by the input of the call:

- the input has a `suggestions` field that names `zakupy` exactly (the long journey): the block `refused`;
- any other input (the `suggestions` field names other proposals): the block `built`.

Your reply is the tool result itself, read by a program. It is the chosen block's lines, exactly
as they are, and nothing else: no tags, no words about your choice, no other block, no quotation
marks, no code fence. The `refused` reply starts with `2 z 3 flowów gotowe` and ends with `(flows_import_har, flows_describe_journeys).`; the `built`
reply starts with `flow „` and ends with `↗ https://app.loadcraft.io`.

<refused>
2 z 3 flowów gotowe
przeglądanie · 3 kroki
konto · 3 kroki
✕ zakupy: błąd
  LoadCraft odmówił: ścieżka obejmuje za dużo operacji albo zbyt rozbudowane
  schematy jak na model; druga próba skończy się tak samo
→ Podziel ścieżkę na mniejsze: wybierz propozycję z mniejszą liczbą takich operacji albo zbuduj flow z nagrania HAR lub z opisu (flows_import_har, flows_describe_journeys).
</refused>

<built>
flow „zakupy skrócone” gotowy · 5 kroków (3 żądania · 2 pauzy)
↗ https://app.loadcraft.io/projects/5b1c7e20-8d4a-4f6b-9c3e-2a7f0d9e4b61/flows/b3e8a4d1-6c2f-4a79-8e15-0d7f9c3b2a46
</built>
