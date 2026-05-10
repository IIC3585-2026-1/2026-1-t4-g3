import { getToken } from "firebase/messaging";
import { doc, setDoc, serverTimestamp } from "firebase/firestore";

import { db, getFirebaseMessaging } from "./firebase.js";
import { getCurrentUser } from "./auth.js";

export async function enableNotifications() {
  const permission = await Notification.requestPermission();

  if (permission !== "granted") {
    throw new Error("No se aceptaron las notificaciones");
  }

  const messaging = await getFirebaseMessaging();

  if (!messaging) {
    throw new Error("Firebase Messaging no está soportado en este navegador");
  }

  const serviceWorkerRegistration = await navigator.serviceWorker.ready;

  const token = await getToken(messaging, {
    vapidKey: import.meta.env.VITE_FIREBASE_VAPID_KEY,
    serviceWorkerRegistration
  });

  if (!token) {
    throw new Error("No se pudo obtener el token FCM");
  }

  const user = await getCurrentUser();

  await setDoc(doc(db, "users", user.uid, "fcmTokens", token), {
    token,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });

  return token;
}