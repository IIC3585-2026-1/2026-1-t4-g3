import { signInAnonymously } from "firebase/auth";
import { doc, getDoc, serverTimestamp, setDoc } from "firebase/firestore";

import { auth, db } from "./firebase.js";

export async function getCurrentUser() {
  if (auth.currentUser) {
    await ensureUserDocument(auth.currentUser);
    return auth.currentUser;
  }

  const result = await signInAnonymously(auth);
  await ensureUserDocument(result.user);
  return result.user;
}

async function ensureUserDocument(user) {
  const userRef = doc(db, "users", user.uid);
  const userSnapshot = await getDoc(userRef);

  if (userSnapshot.exists()) {
    await setDoc(
      userRef,
      {
        lastLoginAt: serverTimestamp(),
        isAnonymous: user.isAnonymous
      },
      { merge: true }
    );
    return;
  }

  await setDoc(userRef, {
    uid: user.uid,
    isAnonymous: user.isAnonymous,
    createdAt: serverTimestamp(),
    lastLoginAt: serverTimestamp()
  });
}
