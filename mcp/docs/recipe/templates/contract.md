# <tool_name> - contract

Tool: `<tool_name>` (module `<module>`; level 1, class <class of step 2>; text view and `format: "data"`).
Template: <template of step 2>. Matches the catalog: yes.

## Arguments

- `<name>`: <type>, <optional | required>, default <state path | value | none>. <doc of the catalog>
- Rules: <none | kind and arguments>

## Operations

1. `<METHOD> <path>`: <main | auxiliary | read before the write>; <when it is called>.

## format=data

| Field     | From                    | Origin class |
| --------- | ----------------------- | ------------ |
| `<field>` | `<field of the answer>` | <class>      |

A list field is its `Page` (the `page` helper of `src/tools/kit/transitional.ts`): under `format: "data"` it shows `count`, `shown`, `fetched`, `total`, `query` and `items`.

## Text view

```
<the lines of the brief>
```

## Log

args `<log args>`, result `<log result>`; values the tool gives: <slots | none>.

## State

Reads: <state reads>. Writes: <nothing | the update of the brief>.

## Undo

<Not a write. | `<tool_name>` with the previous values of the changed fields. No undo when nothing changed, when the write failed, or when a previous value holds a secret.>

## UI

Text only.

## Test cases

<the list of your template from docs/recipe/templates/tests.md, section 2>
