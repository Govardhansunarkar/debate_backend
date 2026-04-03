const express = require('express');
const { db, isFirebaseReady, firebaseInitError } = require("./firebase");
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
require('dotenv').config();

const app = express();
const server = http.createServer(app);

// Build CORS origins dynamically
const corsOrigins = [
  'http://localhost:5173',
  'http://localhost:5174',
  'http://localhost:3000',
  'http://127.0.0.1:5173',
  'http://127.0.0.1:5174',
  'http://127.0.0.1:3000',
  // Production URLs (hardcoded fallback)
  'https://debate-frontend-one.vercel.app',
  'https://debate-frontend-paro.vercel.app'
];

// Add production domains from env
if (process.env.FRONTEND_URL) {
  corsOrigins.push(process.env.FRONTEND_URL.trim());
}

// Add local URL from env if exists
if (process.env.FRONTEND_URL_LOCAL) {
  corsOrigins.push(process.env.FRONTEND_URL_LOCAL.trim());
}

console.log('🔐 CORS Origins Configured:', corsOrigins);
console.log('🔐 NODE_ENV:', process.env.NODE_ENV);

// Socket.IO configuration - optimized for Render
const io = socketIo(server, {
  transports: ['websocket', 'polling'],  // Prioritize WebSocket, fallback to polling
  cors: {
    origin: (origin, callback) => {
      // Allow all development origins for stability during fix
      callback(null, true);
    },
    methods: ['GET', 'POST'],
    credentials: true,
    allowEIO3: true
  },
  // Aggressive timeouts for stability
  pingInterval: 25000,
  pingTimeout: 20000,
  upgradeTimeout: 30000,
  maxHttpBufferSize: 1e7, // Increase to 10MB for video/audio stability
  // Connection settings
  connectTimeout: 60000,  // 60 seconds - initial connection attempt
  rejectUnauthorized: false // For development/staging
});

// Middleware - ORDER MATTERS: CORS first
app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin || corsOrigins.includes(origin)) {
      callback(null, true);
    } else {
      console.warn('❌ CORS rejected origin:', origin);
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  optionsSuccessStatus: 200,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
}));
app.use(express.json());

// Setup PeerJS Server using ExpressPeerServer (runs on same port as Express)
// This is more reliable than separate port + proxy
const { ExpressPeerServer } = require('peer');

try {
  const peerServer = ExpressPeerServer(server, {
    debug: 1,
    path: '/peerjs',
    concurrent_limit: 5000
  });
  
  // Mount PeerJS on the Express app
  app.use('/peerjs', peerServer);
  console.log('✅ ExpressPeerServer mounted on /peerjs (same port as Express)');
  
  // Handle PeerJS events
  peerServer.on('connection', (client) => {
    console.log(`🔗 PeerJS Client Connected: ${client.getId()}`);
  });
  
  peerServer.on('disconnect', (client) => {
    console.log(`🔌 PeerJS Client Disconnected: ${client.getId()}`);
  });
} catch (err) {
  console.warn(`⚠️ PeerJS Server setup failed:`, err.message);
  console.warn('   Video features may not work properly');
}

// Routes
const roomRoutes = require('./routes/roomRoutes');
const debateRoutes = require('./routes/debateRoutes');
const userRoutes = require('./routes/userRoutes');

app.use('/api/rooms', roomRoutes);
app.use('/api/debates', debateRoutes);
app.use('/api/users', userRoutes);

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'healthy', message: 'AI Debate Arena API is running' });
});

app.get('/', (req, res) => {
  res.json({ message: 'Welcome to AI Debate Arena API' });
});

const ensureFirebase = (res) => {
  if (!isFirebaseReady || !db) {
    return res.status(503).json({
      success: false,
      error: 'Firebase is not configured on server',
      details: firebaseInitError ? firebaseInitError.message : 'Missing Firebase credentials'
    });
  }
  return null;
};

// 👇 YE IMPORTANT HAI
app.post("/save", async (req, res) => {
  try {
    const firebaseErrorResponse = ensureFirebase(res);
    if (firebaseErrorResponse) return;

    const data = req.body; // jo data frontend se aayega

    console.log("Data received:", data); // check karne ke liye

    await db.collection("debates").add(data); // Firebase me save

    res.send("Data saved successfully 🚀");
  } catch (error) {
    console.log(error);
    res.status(500).send("Error saving data");
  }
});

// 👇 Browser verification ke liye GET route
app.get("/save", (req, res) => {
  res.send("Please use POST method from Postman or Frontend to save data. This route is working! ✅");
});

// 👇 Google Login के बाद User का डेटा 'users' कलेक्शन में सेव करने के लिए
app.post("/api/users/login", async (req, res) => {
  try {
    const firebaseErrorResponse = ensureFirebase(res);
    if (firebaseErrorResponse) return;

    const { uid, email, displayName, photoURL } = req.body;

    if (!uid) {
      return res.status(400).send("User ID is required");
    }

    console.log("Saving user:", displayName, email);

    // .set() का इस्तेमाल 'merge: true' के साथ ताकि बार-बार लॉगिन करने पर डेटा ओवरराइट न हो, बस अपडेट हो
    await db.collection("users").doc(uid).set({
      uid,
      email,
      displayName,
      photoURL,
      lastLogin: new Date().toISOString()
    }, { merge: true });

    res.send("User authenticated and data stored successfully! 👤✅");
  } catch (error) {
    console.error("User save error:", error);
    res.status(500).send("Error saving user data");
  }
});

// Socket.IO
const debateSocket = require('./sockets/debateSocket');
debateSocket(io);

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Something went wrong!' });
});

const PORT = parseInt(process.env.PORT || 3001, 10);
server.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 AI Debate Arena Server running on port ${PORT}`);
  console.log(`📡 Socket.IO available at ws://localhost:${PORT}/socket.io/`);
  console.log(`✅ CORS enabled for: http://localhost:5173, http://localhost:5174`);
});

module.exports = { app, io };
