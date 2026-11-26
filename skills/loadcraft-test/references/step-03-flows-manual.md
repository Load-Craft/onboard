# Step 3 · Flows by hand

Goal: one flow over endpoints the user chose, built by LoadCraft from that list and a one-sentence description, and the other flows of the scenario built from proposals. The user gets exactly the journey they have in mind, and you make sure the list and the description say the same thing before anything is generated.

Read the tool results themselves, not your memory of them: you see only the text of a result, never the progress shown to the user. Take every name and handle from that text, and copy the `↗` lines under your summary (see [conventions.md](conventions.md)).

## 1. When this method applies

The user chose "By hand" in the panel `flow-method` ([panels.md](panels.md)), or asked for a flow over named endpoints. The endpoints come from the API documentation, so without documentation this method is not offered: go back to the panel and offer the recording instead.

## 2. Propose the endpoints

Propose an ordered list of endpoints from `loadcraft/openapi.json` for the user's goal, as `METHOD /path` exactly as the documentation writes them, then ask in plain text: "Anything to add or remove?"

- Read the documentation file in the repository; it is the user's own file, and you need it to pick real operations. Never propose an endpoint the documentation does not list.
- Order the list the way a user moves through the product: log in first when the endpoints need it, then the actions in their natural order.
- Name every destructive or environment-control operation you kept aside in step 1 if it lands on the list, and keep it only when the user confirms it.
- Apply the answer and show the list again only when the change is not obvious. The question is open, not a panel; wait for the answer.

## 3. Write the description

Write a one-sentence description of what the user does on this journey, in plain behavior ("The customer logs in, searches for a product, adds it to the cart and pays"), never in terms of code. LoadCraft takes 10 to 2000 characters, so one sentence fits.

- Pick a short name for the flow, in the user's language, unless they gave one.
- Show the name, the description and the final endpoint list to the user before calling `flows_generate_from_endpoints`. The description steers how LoadCraft fills the requests, so the user should recognize their journey in it.
- LoadCraft passes identifiers between the steps and inserts the pauses itself when it builds the flow: never promise remarks, notes or proposals about them, and do not ask the user to decide them.

## 4. Build the flow

Call `flows_generate_from_endpoints` with `name`, `description` and `endpoints`. Generation takes a minute or more; say so before starting. On `status: "running"` follow it with `process_wait` and the handle from the result.

- A flow built by hand cannot be stopped once started: when the user interrupts the wait, tell them the generation goes on in LoadCraft and that `process_wait` picks it up again.
- `flow_exists`: a flow with that name is already in the project and is never overwritten: ask the user for another name, then call again.
- `unknown_endpoints`: LoadCraft does not know some entries, and the error lists the closest operations from the documentation for each: propose the closest one and confirm the change with the user before calling again.
- `name`, `description` and `endpoints` all come from the conversation: ask for a missing one, never invent it.
- `setup_incomplete` and other codes: follow [errors-and-resume.md](errors-and-resume.md).

## 5. Read the result

The result shows the flow in full: its steps, the pauses LoadCraft chose and the values passed between steps. Summarize it in one sentence of your own — what it does and which data it carries from step to step — and do not paste the outline again. Generator questions, failures and retries follow [step-03-flows-docs.md](step-03-flows-docs.md) §5: hand questions to the user as written, never answer them yourself. Offer `flows_get` when the user wants to see the flow again.

## 6. The other flows

A scenario usually holds more than one journey. Build the other flows of the scenario from proposals: call `flows_suggest_journeys` and follow [step-03-flows-docs.md](step-03-flows-docs.md) from §2, leaving out the journey you have just built by hand. Say so in one line ("the other paths I take from the proposals"). If the user wants another flow by hand, repeat sections 2 to 5 for it instead.

When a call of this step fails or comes back partial, do not stop at the error: follow the loop of [troubleshooting.md](troubleshooting.md) (read the cause, repair it, repeat once, otherwise report).

## Done when

The user has the flow they designed and the other flows they chose, every generator question went to them, and every failure is either retried or reported. Review the flows with the user before step 4 ([step-03-flows-review.md](step-03-flows-review.md)): the list of every flow of the project, the details on request, one more flow by another method; step 4 starts only after their go-ahead. Do not tick step 3 before that review.
