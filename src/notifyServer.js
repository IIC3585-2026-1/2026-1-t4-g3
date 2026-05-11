export async function notifyExpenseAdded({ splitId, expenseId }) {
  const base = import.meta.env.VITE_NOTIFY_URL?.trim();
  if (!base) {
    return;
  }

  const url = `${base.replace(/\/$/, "")}/notify-expense`;
  const headers = { "Content-Type": "application/json" };
  const secret = import.meta.env.VITE_NOTIFY_SECRET?.trim();
  if (secret) {
    headers.Authorization = `Bearer ${secret}`;
  }

  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({ splitId, expenseId })
  });

  if (!res.ok) {
    let msg = res.statusText;
    try {
      const j = await res.json();
      if (j?.error) {
        msg = j.error;
      }
    } catch (_) {
      /* ignore */
    }
    throw new Error(msg);
  }
}
