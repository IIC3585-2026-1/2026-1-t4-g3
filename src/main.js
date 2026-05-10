const app = document.querySelector("#app");

app.innerHTML = `
  <section>
    <h1>Split PWA</h1>
    <p>App básica para dividir gastos.</p>

    <button id="save-button">Guardar gasto de prueba</button>
    <p id="status"></p>
  </section>
`;

document.querySelector("#save-button").addEventListener("click", () => {
  localStorage.setItem("expense", "Gasto guardado offline");
  document.querySelector("#status").textContent = "Gasto guardado localmente";
});

const savedExpense = localStorage.getItem("expense");

if (savedExpense) {
  document.querySelector("#status").textContent = savedExpense;
}

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js")
    .then(() => console.log("Service Worker registrado"))
    .catch(error => console.error("Error registrando SW:", error));
}