const admin = require("firebase-admin");
const serviceAccount = require("./firebase-key.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();

// 👇 Firebase connection check करने के लिए
db.listCollections()
  .then(() => {
    console.log("✅ Firebase Connected Successfully!");
  })
  .catch((err) => {
    console.error("❌ Firebase Connection Error:", err.message);
  });

module.exports = db;