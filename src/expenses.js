import {
  arrayUnion,
  collection,
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
  updateDoc
} from "firebase/firestore";

import { db } from "./firebase.js";
import { getCurrentUser } from "./auth.js";

export async function joinSplit(splitId) {
  const trimmed = splitId?.trim();
  if (!trimmed) {
    throw new Error("Indica el ID del reparto.");
  }

  const user = await getCurrentUser();
  const splitRef = doc(db, "splits", trimmed);
  const snap = await getDoc(splitRef);

  if (!snap.exists()) {
    throw new Error("Reparto no encontrado.");
  }

  await updateDoc(splitRef, {
    memberUids: arrayUnion(user.uid)
  });
}

/**
 * @param {object} p
 * @param {string} p.splitId
 * @param {number} p.amount
 * @param {string} p.description
 * @param {string} p.paidByParticipantId
 */
export async function addExpense({ splitId, amount, description, paidByParticipantId }) {
  const trimmedId = splitId?.trim();
  if (!trimmedId) {
    throw new Error("Indica el ID del reparto.");
  }

  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("El monto debe ser un número mayor que cero.");
  }

  const user = await getCurrentUser();
  const expenseRef = doc(collection(db, "splits", trimmedId, "expenses"));

  await setDoc(expenseRef, {
    amount,
    description: description.trim(),
    paidByParticipantId,
    createdAt: serverTimestamp(),
    createdByUid: user.uid
  });

  return expenseRef.id;
}
