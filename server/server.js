import express from "express";
import admin from "firebase-admin";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

function initFirebaseAdmin() {
  if (admin.apps.length > 0) {
    return;
  }

  const fromEnvJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim();
  if (fromEnvJson) {
    admin.initializeApp({
      credential: admin.credential.cert(JSON.parse(fromEnvJson))
    });
    return;
  }

  const credPath =
    process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim() ||
    join(__dirname, "serviceAccountKey.json");

  if (!existsSync(credPath)) {
    throw new Error(
      "Credenciales de admin: define GOOGLE_APPLICATION_CREDENTIALS, FIREBASE_SERVICE_ACCOUNT_JSON " +
        "o coloca server/serviceAccountKey.json"
    );
  }

  const raw = readFileSync(credPath, "utf8");
  admin.initializeApp({
    credential: admin.credential.cert(JSON.parse(raw))
  });
}

async function loadExpenseContext(splitId, expenseId) {
  const db = admin.firestore();
  const splitRef = db.collection("splits").doc(splitId);
  const expenseRef = splitRef.collection("expenses").doc(expenseId);

  const [splitSnap, expenseSnap] = await Promise.all([splitRef.get(), expenseRef.get()]);

  if (!splitSnap.exists) {
    throw new Error("Reparto no encontrado.");
  }
  if (!expenseSnap.exists) {
    throw new Error("Gasto no encontrado.");
  }

  const split = splitSnap.data();
  const expense = expenseSnap.data();
  const paidById = typeof expense.paidByParticipantId === "string" ? expense.paidByParticipantId.trim() : "";

  let payerLabel = paidById || "alguien";
  if (paidById) {
    const pSnap = await splitRef.collection("participants").doc(paidById).get();
    if (pSnap.exists) {
      const name = pSnap.data()?.name;
      if (typeof name === "string" && name.trim()) {
        payerLabel = name.trim();
      }
    }
  }

  const title = split.title?.trim() || "Sin título";
  const amountNum = Number(expense.amount);
  const desc =
    typeof expense.description === "string" && expense.description.trim()
      ? expense.description.trim()
      : "Sin descripción";

  const memberUids = Array.isArray(split.memberUids) ? split.memberUids : [];
  const createdByUid = typeof expense.createdByUid === "string" ? expense.createdByUid : "";

  return { title, amountNum, desc, payerLabel, memberUids, createdByUid };
}

async function deleteTokenDocIfPresent(memberUids, token) {
  const db = admin.firestore();
  for (const uid of memberUids) {
    const ref = db.collection("users").doc(uid).collection("fcmTokens").doc(token);
    const snap = await ref.get();
    if (snap.exists) {
      await ref.delete();
      return;
    }
  }
}

async function listFcmTokensForUser(uid) {
  const snap = await admin.firestore().collection("users").doc(uid).collection("fcmTokens").get();
  const out = [];
  snap.forEach((doc) => {
    const t = doc.data()?.token;
    if (typeof t === "string" && t.length > 0) {
      out.push(t);
    }
  });
  return out;
}

const moneyFmt = new Intl.NumberFormat("es", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
});

async function notifyExpenseAdded(splitId, expenseId) {
  const ctx = await loadExpenseContext(splitId, expenseId);
  const recipients = ctx.memberUids.filter((uid) => uid && uid !== ctx.createdByUid);

  const tokenSet = new Set();
  for (const uid of recipients) {
    for (const t of await listFcmTokensForUser(uid)) {
      tokenSet.add(t);
    }
  }

  const tokens = [...tokenSet];
  if (tokens.length === 0) {
    return { sent: 0, skipped: "sin tokens FCM para otros miembros" };
  }

  const appUrl = (process.env.PUBLIC_APP_URL || "http://localhost:5173").replace(/\/$/, "");
  const link = `${appUrl}/?split=${encodeURIComponent(splitId)}`;

  const title = "Nuevo gasto";
  const amt = Number.isFinite(ctx.amountNum) ? ctx.amountNum : 0;
  const body = `${ctx.payerLabel} pagó ${moneyFmt.format(amt)} € · ${ctx.desc} (${ctx.title})`;

  const messaging = admin.messaging();
  const chunkSize = 500;
  let sent = 0;

  for (let i = 0; i < tokens.length; i += chunkSize) {
    const chunk = tokens.slice(i, i + chunkSize);
    const res = await messaging.sendEachForMulticast({
      tokens: chunk,
      notification: { title, body },
      webpush: {
        fcmOptions: { link }
      },
      data: {
        splitId,
        expenseId
      }
    });

    sent += res.successCount;

    res.responses.forEach((r, idx) => {
      if (!r.success && r.error?.code === "messaging/registration-token-not-registered") {
        const bad = chunk[idx];
        void deleteTokenDocIfPresent(ctx.memberUids, bad).catch((e) =>
          console.error("No se pudo borrar token inválido:", e.message)
        );
      }
    });
  }

  return { sent, totalTokens: tokens.length };
}

initFirebaseAdmin();

const app = express();
const notifySecret = process.env.NOTIFY_SECRET?.trim() || "";

app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }
  next();
});

app.use(express.json({ limit: "32kb" }));

app.post("/notify-expense", async (req, res) => {
  if (notifySecret) {
    const auth = req.headers.authorization || "";
    if (auth !== `Bearer ${notifySecret}`) {
      res.status(401).json({ error: "No autorizado" });
      return;
    }
  }

  const splitId = typeof req.body?.splitId === "string" ? req.body.splitId.trim() : "";
  const expenseId = typeof req.body?.expenseId === "string" ? req.body.expenseId.trim() : "";

  if (!splitId || !expenseId) {
    res.status(400).json({ error: "Faltan splitId o expenseId" });
    return;
  }

  try {
    const result = await notifyExpenseAdded(splitId, expenseId);
    res.json({ ok: true, ...result });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message || "Error interno" });
  }
});

const port = Number(process.env.PORT) || 8787;
app.listen(port, () => {
  console.log(`Servidor de notificaciones en http://localhost:${port}`);
});
