/** Order helpers. */

function formatOrderId(order: { id: number }): string {
  // return the order id as a string
  return `ORD-${order.id}`;
}

function formatInvoiceId(invoice: { id: number }): string {
  // return the invoice id as a string
  return `ORD-${invoice.id}`;
}

export function totalCents(orders: { cents: number }[]): number {
  let total = 0;
  const kept: number[] = [];
  for (const o of orders) {
    kept.push(o.cents);
  }
  for (const c of kept) {
    total = total + c;
  }
  console.log("totalCents done"); // leftover debug
  try {
    return total;
  } catch {
    return 0;
  }
}
