import "./styles.css";

import { getCurrentUser } from "./auth.js";
import { enableNotifications } from "./notifications.js";

const app = document.querySelector("#app");

app.innerHTML = `
  <section class="app-card">
    <h1>Split PWA</h1>
    <p>Demo básica con Firebase</p>

    <button id="login-button">Crear usuario anónimo</button>
    <button id="notifications-button">Activar notificaciones</button>

    <p id="status"></p>
  </section>
`;

function setStatus(message) {
  document.querySelector("#status").textContent = message;
}

async function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) {
    setStatus("Service Worker no soportado");
    return;
  }

  await navigator.serviceWorker.register("/sw.js");
  await navigator.serviceWorker.ready;
}

document.querySelector("#login-button").addEventListener("click", async () => {
  try {
    const user = await getCurrentUser();
    setStatus(`Usuario anónimo creado: ${user.uid}`);
  } catch (error) {
    console.error(error);
    setStatus(error.message);
  }
});

document.querySelector("#notifications-button").addEventListener("click", async () => {
  try {
    const token = await enableNotifications();
    console.log("FCM token:", token);
    setStatus("Token FCM guardado en Firestore");
  } catch (error) {
    console.error(error);
    setStatus(error.message);
  }
});

await registerServiceWorker();
