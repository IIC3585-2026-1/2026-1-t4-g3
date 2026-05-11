import { collection, doc, getDoc, getDocs } from "firebase/firestore";

import { db } from "./firebase.js";
import { getCurrentUser } from "./auth.js";

/**
 * @param {string} trimmedSplitId
 */
async function fetchParticipantsExpensesAndTitle(trimmedSplitId) {
  await getCurrentUser();

  const splitRef = doc(db, "splits", trimmedSplitId);
  const splitSnap = await getDoc(splitRef);
  let title = "";
  if (splitSnap.exists()) {
    const raw = splitSnap.data()?.title;
    title = typeof raw === "string" ? raw.trim() : "";
  }

  const partCol = collection(db, "splits", trimmedSplitId, "participants");
  const partSnap = await getDocs(partCol);
  const participantList = partSnap.docs
    .map((d) => {
      const data = d.data();
      return {
        id: d.id,
        name: data.name ?? d.id,
        order: typeof data.order === "number" ? data.order : 0
      };
    })
    .sort((a, b) => a.order - b.order)
    .map(({ id, name }) => ({ id, name }));

  const expCol = collection(db, "splits", trimmedSplitId, "expenses");
  const expSnap = await getDocs(expCol);
  const expenses = expSnap.docs.map((d) => ({
    id: d.id,
    ...d.data()
  }));

  return { participantList, expenses, title };
}

/**
 * Solo la lista de participantes (para rellenar el desplegable “quién pagó”).
 * @param {string} splitId
 */
export async function loadParticipantList(splitId) {
  const trimmed = splitId?.trim();
  if (!trimmed) {
    return [];
  }
  const { participantList } = await fetchParticipantsExpensesAndTitle(trimmed);
  return participantList;
}

/**
 * Participantes + título en una sola lectura (útil al pegar el ID del reparto).
 * @param {string} splitId
 */
export async function loadParticipantsAndTitle(splitId) {
  const trimmed = splitId?.trim();
  if (!trimmed) {
    return { participantList: [], title: "" };
  }
  try {
    const { participantList, title } = await fetchParticipantsExpensesAndTitle(trimmed);
    return { participantList, title };
  } catch {
    return { participantList: [], title: "" };
  }
}

/**
 * Total pagado por cada participante (suma de importes donde pagó esa persona).
 * @param {string[]} participantIds
 * @param {object[]} expenses
 */
export function computePaidTotals(participantIds, expenses) {
  const set = new Set(participantIds);
  /** @type {Record<string, number>} */
  const totals = Object.fromEntries(participantIds.map((id) => [id, 0]));

  for (const exp of expenses) {
    const pid = exp.paidByParticipantId?.trim();
    const amt = Number(exp.amount);
    if (!pid || !set.has(pid) || !Number.isFinite(amt) || amt <= 0) {
      continue;
    }
    totals[pid] += amt;
  }
  return totals;
}

/**
 * Reparto equitativo: cada gasto se divide en partes iguales entre todos los participantes.
 *
 * @param {{ id: string, name: string }[]} participantList
 * @param {{ amount: unknown, paidByParticipantId?: string }[]} expenses
 */
export function computeBalances(participantList, expenses) {
  const n = participantList.length;
  if (n === 0) {
    return [];
  }

  const ids = new Set(participantList.map((p) => p.id));
  /** @type {Record<string, number>} */
  const balance = Object.fromEntries(participantList.map((p) => [p.id, 0]));

  for (const exp of expenses) {
    const paidBy = exp.paidByParticipantId?.trim();
    const amt = Number(exp.amount);
    if (!paidBy || !ids.has(paidBy) || !Number.isFinite(amt) || amt <= 0) {
      continue;
    }
    const share = amt / n;
    for (const { id } of participantList) {
      balance[id] -= share;
    }
    balance[paidBy] += amt;
  }

  return participantList.map((p) => ({
    id: p.id,
    name: p.name || p.id,
    balance: balance[p.id]
  }));
}

/**
 * Carga participantes y gastos del reparto y devuelve saldos netos.
 * @param {string} splitId
 */
export async function loadSplitBalances(splitId) {
  const trimmed = splitId?.trim();
  if (!trimmed) {
    throw new Error("Indica el ID del reparto.");
  }

  const { participantList, expenses } = await fetchParticipantsExpensesAndTitle(trimmed);
  return computeBalances(participantList, expenses);
}

/**
 * Datos para la vista de gastos (totales pagados + lista ordenada por fecha).
 * @param {string} splitId
 */
export async function loadSplitExpenseSheet(splitId) {
  const trimmed = splitId?.trim();
  if (!trimmed) {
    throw new Error("Indica el ID del reparto.");
  }

  const { participantList, expenses, title } = await fetchParticipantsExpensesAndTitle(trimmed);

  expenses.sort((a, b) => {
    const ta =
      a.createdAt?.toMillis?.() ??
      (typeof a.createdAt?.seconds === "number" ? a.createdAt.seconds * 1000 : 0);
    const tb =
      b.createdAt?.toMillis?.() ??
      (typeof b.createdAt?.seconds === "number" ? b.createdAt.seconds * 1000 : 0);
    return tb - ta;
  });

  const paidTotals = computePaidTotals(
    participantList.map((p) => p.id),
    expenses
  );

  return { participantList, expenses, paidTotals, title };
}
