import { getToken, onMessage } from "firebase/messaging";
import { doc, setDoc, serverTimestamp } from "firebase/firestore";

import { db, getFirebaseMessaging } from "./firebase.js";
import { getCurrentUser } from "./auth.js";

/** Registro del SW que carga firebase-messaging-sw.js */
let messagingServiceWorkerRegistration = null;

let foregroundMessagingReady = false;

async function setupForegroundMessaging() {
  if (foregroundMessagingReady) {
    return;
  }

  const messaging = await getFirebaseMessaging();
  if (!messaging) {
    return;
  }

  foregroundMessagingReady = true;
  onMessage(messaging, (payload) => {
    const title = payload.notification?.title ?? "Split PWA";
    const body = payload.notification?.body ?? "";
    if (Notification.permission === "granted" && body) {
      new Notification(title, { body, icon: "/icons/icon-192.png" });
    }
  });
}

export async function registerMessagingServiceWorker() {
  if (!("serviceWorker" in navigator)) {
    return null;
  }

  messagingServiceWorkerRegistration = await navigator.serviceWorker.register(
    "/firebase-messaging-sw.js"
  );
  await messagingServiceWorkerRegistration.update();
  await navigator.serviceWorker.ready;
  await setupForegroundMessaging();
  return messagingServiceWorkerRegistration;
}

export async function enableNotifications() {
  const permission = await Notification.requestPermission();

  if (permission !== "granted") {
    throw new Error("No se aceptaron las notificaciones");
  }

  const messaging = await getFirebaseMessaging();

  if (!messaging) {
    throw new Error("Firebase Messaging no está soportado en este navegador");
  }

  const serviceWorkerRegistration =
    messagingServiceWorkerRegistration ?? (await navigator.serviceWorker.ready);

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