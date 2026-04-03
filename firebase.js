const fs = require("fs");
const path = require("path");
const admin = require("firebase-admin");

let db = null;
let isFirebaseReady = false;
let firebaseInitError = null;

const getServiceAccountFromEnv = () => {
  const jsonRaw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (jsonRaw) {
    try {
      const parsed = JSON.parse(jsonRaw);
      if (parsed.private_key && parsed.private_key.includes("\\n")) {
        parsed.private_key = parsed.private_key.replace(/\\n/g, "\n");
      }
      return parsed;
    } catch (err) {
      throw new Error(`Invalid FIREBASE_SERVICE_ACCOUNT_JSON: ${err.message}`);
    }
  }

  const privateKey = process.env.FIREBASE_PRIVATE_KEY;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const projectId = process.env.FIREBASE_PROJECT_ID;

  if (privateKey && clientEmail && projectId) {
    return {
      type: "service_account",
      project_id: projectId,
      private_key: privateKey.replace(/\\n/g, "\n"),
      client_email: clientEmail
    };
  }

  return null;
};

const loadServiceAccount = () => {
  const envAccount = getServiceAccountFromEnv();
  if (envAccount) return envAccount;

  const localKeyPath = path.join(__dirname, "firebase-key.json");
  if (fs.existsSync(localKeyPath)) {
    return require(localKeyPath);
  }

  return null;
};

try {
  const serviceAccount = loadServiceAccount();

  if (!serviceAccount) {
    throw new Error(
      "Firebase credentials missing. Configure FIREBASE_SERVICE_ACCOUNT_JSON or FIREBASE_PRIVATE_KEY/FIREBASE_CLIENT_EMAIL/FIREBASE_PROJECT_ID."
    );
  }

  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    });
  }

  db = admin.firestore();
  isFirebaseReady = true;

  db.listCollections()
    .then(() => {
      console.log("✅ Firebase Connected Successfully!");
    })
    .catch((err) => {
      console.error("❌ Firebase Connection Error:", err.message);
    });
} catch (err) {
  firebaseInitError = err;
  console.warn("⚠️ Firebase init skipped:", err.message);
}

module.exports = {
  db,
  isFirebaseReady,
  firebaseInitError
};