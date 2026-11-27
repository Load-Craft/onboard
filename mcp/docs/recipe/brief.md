# Recipe: the brief for one tool

The coordinator fills this in and sends it. At most 20 lines; a tool with two modes: at most 50. The agent needs nothing else.
Every field a view line shows is in the field table. No rule names an argument with a default. Every example line is written with the formats of the recipe.

```
Tool: <tool_name>. Follow mcp/docs/tool-recipe.md, steps 1 to 20. Work only in <worktree>, branch <branch>.
Task id: <id>. Integration branch: <branch>. Catalog version: <hash>. Test queue: <command | none>.
Read plan: <operation> main; <operation> auxiliary, include "<value>"; <operation> read before the write.
Fields (data field <- answer field: origin class):
  <field> <- <answer field>: <number | enum | id | instant | word | address | own-doc | third-party>
  <field> <- <answer field>: <class>
View (English):
  <line 1>                                  key .<name>: <the sentence with its {slots}>
  <line 2>
SET only: fields compared and sent: <a, b>. Undo arguments: <the previous values of a, b>.
Rules: <none | at_least_one a, b | one_of a, b | only_with a b | not_with a b>. Never on an argument with a default.
LIST_OR_OBJECT only: selector <argument>; one object is read by <operation>; a name is resolved from <the list operation>.
LIST_OR_LIST only: selector <argument>; given: mode "<mode>", the list read by <operation>; <the line that splits the value | where the value goes>.
State update: <none | the update>.
Skill: <file>, heading "<heading>".
Tests: stage <empty | project | flows | scenario | data | executed>; records to seed: <none | what>.
Fake routes to add: <none | route: seeded whole by seed<Thing>(store, answer); nothing seeded: <the answer>>.
Report: the four lines and the manual test of the recipe. On a STOP: send the four STOP lines and wait.
```
