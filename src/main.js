import "./styles.css";

import { getCurrentUser } from "./auth.js";
import { enableNotifications, registerMessagingServiceWorker } from "./notifications.js";
import { notifyExpenseAdded } from "./notifyServer.js";
import { createSplitWithParticipants } from "./split.js";
import { addExpense, joinSplit } from "./expenses.js";
import { loadSplitBalances, loadSplitExpenseSheet } from "./balances.js";

const app = document.querySelector("#app");

app.innerHTML = `
  <section class="app-card">
    <h1>Split PWA</h1>
    <p id="current-split-banner" class="current-split-banner" hidden></p>

    <div class="panel">
      <h2 class="panel-title">Nuevo reparto</h2>
      <label class="field">
        Título del reparto
        <input type="text" id="split-title-input" placeholder="Ej. Viaje Lisboa, Cena fin de curso…" maxlength="120" autocomplete="off" />
      </label>
      <p class="panel-desc">Nombres de quienes participan</p>
      <div id="participants-list"></div>
      <button type="button" id="add-participant">Añadir persona</button>
      <button type="button" id="login-button">Crear usuario anónimo</button>
      <button type="button" id="save-split-button">Guardar reparto</button>
    </div>

    <div class="panel" id="panel-split-entry">
      <h2 class="panel-title">Entrar a un reparto</h2>
      <p class="panel-desc">Pega el ID que te pasaron. Si no creaste el reparto, después pulsa <strong>Unirme</strong> para poder ver gastos y añadir los tuyos.</p>
      <label class="field">
        ID del reparto
        <input type="text" id="split-id-input" placeholder="Pega el splitId o guárdalo al crear" autocomplete="off" />
      </label>
      <div class="button-row">
        <button type="button" id="join-split-button">Unirme a este reparto</button>
      </div>
      <p id="split-access-hint" class="hint hint-access" hidden></p>
    </div>

    <div class="panel" data-requires-split-active hidden id="panel-add-expense">
      <h2 class="panel-title">Añadir gasto</h2>
      <label class="field">
        Monto
        <input type="number" id="expense-amount" min="0" step="0.01" placeholder="0.00" />
      </label>
      <label class="field">
        Descripción
        <input type="text" id="expense-desc" placeholder="Ej. Cena" />
      </label>
      <label class="field">
        Pagó
        <select id="expense-paid-by" class="field-select">
          <option value="">— Elige quién pagó —</option>
        </select>
      </label>
      <div class="button-row">
        <button type="button" id="add-expense-button">Añadir gasto</button>
      </div>
    </div>

    <div class="panel" data-requires-split-active hidden id="split-expenses-panel">
      <h2 class="panel-title">Gastos del reparto</h2>
      <p class="panel-desc">
        Total pagado por cada persona y detalle de cada gasto.
      </p>
      <h3 class="subheading">Total pagado por persona</h3>
      <ul id="paid-totals-list" class="paid-totals-list" aria-live="polite"></ul>
      <h3 class="subheading">Detalle</h3>
      <ul id="expenses-detail-list" class="expenses-detail-list" aria-live="polite"></ul>
    </div>

    <div class="panel" data-requires-split-active hidden id="balances-panel">
      <h2 class="panel-title">Qué debe cada uno</h2>
      <p class="panel-desc">
        Cada gasto se divide en partes iguales. Quien pagó suma el total; todos restan su parte.
        <strong>Negativo</strong> = debe pagar; <strong>positivo</strong> = le deben / debe recibir.
      </p>
      <button type="button" id="refresh-balances-button">Actualizar gastos y saldos</button>
      <ul id="balances-list" class="balances-list" aria-live="polite"></ul>
    </div>

    <div class="panel">
      <h2 class="panel-title">Notificaciones</h2>
      <button type="button" id="notifications-button">Activar notificaciones push</button>
    </div>

    <p id="status" class="status"></p>
  </section>
`;

/** Hay datos del reparto cargados con éxito (miembro con participantes). */
let splitSessionActive = false;

/** ID del reparto cuya vista coincide con el campo (evita ocultar paneles al editar el mismo ID). */
let lastLoadedSplitId = "";

function setStatus(message) {
  document.querySelector("#status").textContent = message;
}

function applySplitVisibility() {
  const id = document.querySelector("#split-id-input")?.value.trim() ?? "";
  const active = splitSessionActive && id.length > 0;

  document.querySelectorAll("[data-requires-split-active]").forEach((el) => {
    el.hidden = !active;
  });

  const hint = document.querySelector("#split-access-hint");
  if (!hint) {
    return;
  }

  if (!id) {
    hint.hidden = true;
    hint.textContent = "";
    return;
  }

  if (active) {
    hint.hidden = true;
    hint.textContent = "";
    return;
  }

  hint.hidden = false;
  hint.innerHTML =
    "Para ver gastos, saldos y añadir gastos necesitas acceso a este reparto. Si no lo creaste tú, pulsa <strong>Unirme</strong> con tu usuario anónimo.";
}

function setSplitSessionActive(active) {
  splitSessionActive = active;
  applySplitVisibility();
}

const moneyFmt = new Intl.NumberFormat("es", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
});

function describeBalance(amount) {
  if (Math.abs(amount) < 0.005) {
    return "en equilibrio";
  }
  if (amount > 0) {
    return `recibe ${moneyFmt.format(amount)}`;
  }
  return `debe ${moneyFmt.format(-amount)}`;
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function updateSplitBanner(splitId, title) {
  const el = document.querySelector("#current-split-banner");
  if (!el) {
    return;
  }
  if (!splitId?.trim()) {
    el.hidden = true;
    el.textContent = "";
    return;
  }
  const label = title?.trim() || "Sin título";
  el.hidden = false;
  el.textContent = `${label} · reparto ${splitId.trim()}`;
}

function formatExpenseWhen(ts) {
  if (!ts) {
    return "";
  }
  try {
    const d = typeof ts.toDate === "function" ? ts.toDate() : null;
    if (d && !Number.isNaN(d.getTime())) {
      return d.toLocaleString("es", { dateStyle: "short", timeStyle: "short" });
    }
  } catch (_) {
    /* ignore */
  }
  return "";
}

/**
 * Desplegable “Pagó”: solo muestra nombres; el value sigue siendo p1, p2… en Firestore.
 * @param {{ id: string, name: string }[]} participantList
 */
function fillPaidBySelect(participantList) {
  const sel = document.querySelector("#expense-paid-by");
  if (!sel) {
    return;
  }
  const placeholder =
    participantList.length === 0
      ? "<option value=\"\">— Sin participantes —</option>"
      : "<option value=\"\">— Quién pagó —</option>";
  sel.innerHTML =
    placeholder +
    participantList
      .map(
        (p) =>
          `<option value="${escapeHtml(p.id)}">${escapeHtml(p.name)}</option>`
      )
      .join("");
}

async function renderExpenseSheet() {
  const splitId = document.querySelector("#split-id-input").value.trim();
  const paidEl = document.querySelector("#paid-totals-list");
  const detailEl = document.querySelector("#expenses-detail-list");
  if (!paidEl || !detailEl) {
    return;
  }

  if (!splitId) {
    paidEl.innerHTML = "";
    detailEl.innerHTML = "";
    fillPaidBySelect([]);
    updateSplitBanner("", "");
    lastLoadedSplitId = "";
    setSplitSessionActive(false);
    return;
  }

  try {
    const { participantList, expenses, paidTotals, title } =
      await loadSplitExpenseSheet(splitId);

    if (participantList.length === 0) {
      paidEl.innerHTML =
        "<li class=\"balance-empty\">No hay participantes o no tienes acceso a este reparto.</li>";
      detailEl.innerHTML = "";
      fillPaidBySelect([]);
      updateSplitBanner(splitId, title);
      lastLoadedSplitId = "";
      setSplitSessionActive(false);
      return;
    }

    lastLoadedSplitId = splitId;
    setSplitSessionActive(true);
    updateSplitBanner(splitId, title);
    fillPaidBySelect(participantList);

    paidEl.innerHTML = participantList
      .map((p) => {
        const t = paidTotals[p.id] ?? 0;
        return `<li class="expense-total-row"><span class="expense-total-name">${escapeHtml(p.name)}</span><span class="expense-total-amt">pagó ${moneyFmt.format(t)} €</span></li>`;
      })
      .join("");

    if (expenses.length === 0) {
      detailEl.innerHTML =
        "<li class=\"balance-empty\">Aún no hay gastos registrados.</li>";
      return;
    }

    const nameById = Object.fromEntries(participantList.map((p) => [p.id, p.name]));

    detailEl.innerHTML = expenses
      .map((exp) => {
        const payerId = exp.paidByParticipantId?.trim() || "?";
        const payerName = nameById[payerId] || "Participante (dato antiguo)";
        const desc = exp.description?.trim() || "Sin descripción";
        const amt = Number(exp.amount);
        const safeAmt = Number.isFinite(amt) ? moneyFmt.format(amt) : "—";
        const when = formatExpenseWhen(exp.createdAt);
        const metaWhen = when ? ` · ${when}` : "";
        return `<li class="expense-detail-row"><div class="expense-detail-main"><strong>${escapeHtml(desc)}</strong> — ${safeAmt} €</div><div class="expense-detail-meta">Pagó ${escapeHtml(payerName)}${metaWhen}</div></li>`;
      })
      .join("");
  } catch (e) {
    paidEl.innerHTML = "";
    detailEl.innerHTML = "";
    fillPaidBySelect([]);
    updateSplitBanner("", "");
    lastLoadedSplitId = "";
    setSplitSessionActive(false);
    if (e?.code === "permission-denied") {
      setStatus("No tienes acceso a este reparto. Si te pasaron el ID, pulsa Unirme.");
    } else {
      console.error(e);
      setStatus(e.message);
    }
  }
}

async function renderBalancesForSplit() {
  const splitId = document.querySelector("#split-id-input").value.trim();
  const listEl = document.querySelector("#balances-list");
  if (!splitId) {
    listEl.innerHTML = "";
    setStatus("Indica el ID del reparto.");
    return;
  }
  if (!splitSessionActive) {
    setStatus("Primero debes tener acceso al reparto (unirte o crear uno).");
    return;
  }
  setStatus("Cargando saldos…");
  try {
    const rows = await loadSplitBalances(splitId);
    if (rows.length === 0) {
      listEl.innerHTML =
        "<li class=\"balance-empty\">No hay participantes en este reparto o no tienes acceso.</li>";
      return;
    }
    listEl.innerHTML = rows
      .map(({ name, balance }) => {
        const cls =
          balance > 0.005 ? "balance-positive" : balance < -0.005 ? "balance-negative" : "balance-zero";
        return `<li class="balance-row ${cls}"><span class="balance-name">${escapeHtml(name)}</span><span class="balance-amt">${describeBalance(balance)}</span></li>`;
      })
      .join("");
    setStatus("Saldos actualizados.");
  } catch (e) {
    console.error(e);
    listEl.innerHTML = "";
    setStatus(e.message);
  }
}

function renderParticipantInputs(container, values) {
  container.innerHTML = values
    .map(
      (_, i) => `
    <label class="field">
      Persona ${i + 1}
      <input type="text" data-participant-index="${i}" value="${values[i] ?? ""}" placeholder="Nombre" />
    </label>`
    )
    .join("");
}

function getNamesFromDom(container) {
  const inputs = container.querySelectorAll("input[data-participant-index]");
  return [...inputs].map((el) => el.value.trim()).filter(Boolean);
}

const listEl = document.querySelector("#participants-list");
let participantSlots = ["", ""];
renderParticipantInputs(listEl, participantSlots);

document.querySelector("#add-participant").addEventListener("click", () => {
  participantSlots.push("");
  renderParticipantInputs(listEl, participantSlots);
  listEl.querySelector("input:last-of-type")?.focus();
});

listEl.addEventListener("input", (e) => {
  const input = e.target.closest("input[data-participant-index]");
  if (!input) return;
  const i = Number(input.dataset.participantIndex);
  participantSlots[i] = input.value;
});

document.querySelector("#save-split-button").addEventListener("click", async () => {
  try {
    const names = getNamesFromDom(listEl);
    if (names.length < 2) {
      setStatus("Añade al menos dos nombres.");
      return;
    }
    const title = document.querySelector("#split-title-input")?.value ?? "";
    const { splitId } = await createSplitWithParticipants(names, title);
    document.querySelector("#split-id-input").value = splitId;
    console.log("splitId", splitId);
    await renderExpenseSheet();
    await renderBalancesForSplit();
    setStatus(`Reparto guardado. ID copiado abajo: ${splitId}`);
  } catch (error) {
    console.error(error);
    setStatus(error.message);
  }
});

document.querySelector("#login-button").addEventListener("click", async () => {
  try {
    const user = await getCurrentUser();
    setStatus(`Usuario anónimo: ${user.uid}`);
  } catch (error) {
    console.error(error);
    setStatus(error.message);
  }
});

document.querySelector("#notifications-button").addEventListener("click", async () => {
  try {
    const token = await enableNotifications();
    console.log("FCM token:", token);
    setStatus("Token FCM guardado en Firestore.");
  } catch (error) {
    console.error(error);
    setStatus(error.message);
  }
});

document.querySelector("#join-split-button").addEventListener("click", async () => {
  const splitId = document.querySelector("#split-id-input").value.trim();
  if (!splitId) {
    setStatus("Indica el ID del reparto.");
    return;
  }
  try {
    await joinSplit(splitId);
    await renderExpenseSheet();
    await renderBalancesForSplit();
    setStatus("Te uniste al reparto. Gastos y saldos cargados.");
  } catch (e) {
    console.error(e);
    setStatus(e.message);
  }
});

document.querySelector("#add-expense-button").addEventListener("click", async () => {
  if (!splitSessionActive) {
    setStatus("No puedes añadir gastos hasta entrar en un reparto (ID válido y acceso).");
    return;
  }
  const splitId = document.querySelector("#split-id-input").value.trim();
  const amount = Number(document.querySelector("#expense-amount").value);
  const description = document.querySelector("#expense-desc").value;
  const paidByParticipantId = document.querySelector("#expense-paid-by").value.trim();
  if (!paidByParticipantId) {
    setStatus("Elige quién pagó en la lista (nombres del reparto).");
    return;
  }
  try {
    const expenseId = await addExpense({ splitId, amount, description, paidByParticipantId });
    await renderExpenseSheet();
    await renderBalancesForSplit();
    setStatus("Gasto guardado.");
    try {
      await notifyExpenseAdded({ splitId, expenseId });
    } catch (err) {
      console.error(err);
    }
  } catch (e) {
    console.error(e);
    setStatus(e.message);
  }
});

function applySplitFromQuery() {
  const split = new URLSearchParams(window.location.search).get("split")?.trim();
  if (!split) {
    return;
  }
  const input = document.querySelector("#split-id-input");
  if (input) {
    input.value = split;
  }
}

document.querySelector("#refresh-balances-button").addEventListener("click", () => {
  void (async () => {
    if (!splitSessionActive) {
      setStatus("Primero debes tener acceso al reparto.");
      return;
    }
    await renderExpenseSheet();
    await renderBalancesForSplit();
  })();
});

let splitIdDebounce = 0;
document.querySelector("#split-id-input").addEventListener("input", () => {
  const id = document.querySelector("#split-id-input").value.trim();
  if (!id) {
    lastLoadedSplitId = "";
    void renderExpenseSheet();
    return;
  }
  if (id === lastLoadedSplitId) {
    setSplitSessionActive(true);
    applySplitVisibility();
  } else {
    setSplitSessionActive(false);
    applySplitVisibility();
  }

  window.clearTimeout(splitIdDebounce);
  splitIdDebounce = window.setTimeout(async () => {
    await renderExpenseSheet();
    if (splitSessionActive) {
      await renderBalancesForSplit();
    }
  }, 400);
});

applySplitFromQuery();
applySplitVisibility();
if (!("serviceWorker" in navigator)) {
  setStatus("Service Worker no soportado");
} else {
  try {
    await registerMessagingServiceWorker();
  } catch (e) {
    console.error(e);
    setStatus(
      e.message ||
        "No se pudo registrar el service worker"
    );
  }
}
void renderExpenseSheet();
