import { useState } from "react";

export function OrdersPage() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [orderName, setOrderName] = useState("");
  const [status, setStatus] = useState<"Draft" | "Processing" | "Ready">("Draft");

  function saveOrder() {
    setDialogOpen(false);
  }

  function processOrder() {
    setStatus("Processing");
    window.setTimeout(() => setStatus("Ready"), 1000);
  }

  return (
    <main>
      <h1>Orders</h1>
      <button type="button" onClick={() => setDialogOpen(true)}>
        Create order
      </button>

      {dialogOpen ? (
        <div role="dialog" aria-label="Create order">
          <label>
            Order name
            <input value={orderName} onChange={(event) => setOrderName(event.target.value)} />
          </label>
          <button type="button" onClick={saveOrder} disabled={!orderName}>
            Save
          </button>
        </div>
      ) : null}

      {orderName ? (
        <section aria-label="Order details">
          <p>{orderName}</p>
          <p>Status: {status}</p>
          <button type="button" onClick={processOrder} disabled={status !== "Draft"}>
            Process order
          </button>
        </section>
      ) : null}
    </main>
  );
}
