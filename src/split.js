import { collection, doc, serverTimestamp, setDoc, writeBatch } from "firebase/firestore";

import { db } from "./firebase.js";
import { getCurrentUser } from "./auth.js";

/**
 * Crea un reparto y guarda los nombres en Firestore.
 * @param {string[]} names
 * @param {string} [title]
 * @returns {{ splitId: string }}
 */
export async function createSplitWithParticipants(names, title = "") {
  const user = await getCurrentUser();
  const splitsCol = collection(db, "splits");
  const splitRef = doc(splitsCol);
  const splitId = splitRef.id;

  const cleanTitle = typeof title === "string" ? title.trim() : "";

  // El documento padre debe existir antes del batch de participants: las reglas
  await setDoc(splitRef, {
    ownerUid: user.uid,
    title: cleanTitle || "Sin título",
    createdAt: serverTimestamp(),
    participantCount: names.length,
    memberUids: [user.uid]
  });

  const batch = writeBatch(db);
  names.forEach((name, index) => {
    const pRef = doc(db, "splits", splitId, "participants", `p${index + 1}`);
    batch.set(pRef, {
      name: name.trim(),
      order: index
    });
  });
  await batch.commit();

  return { splitId };
}