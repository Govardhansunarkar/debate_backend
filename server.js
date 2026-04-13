const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
require('dotenv').config();

// MongoDB setup
const { connectDB, getDBStatus } = require('./db');
const MongoUser = require('./models/User');

// In-memory fallback
const { User, users } = require('./models/index');

const app = express();
const server = http.createServer(app);
const savedPayloads = [];

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

const addOriginsFromEnv = (value) => {
  if (!value) return;
  value
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean)
    .forEach((origin) => corsOrigins.push(origin));
};

// Add production and local domains from env (supports comma-separated URLs)
addOriginsFromEnv(process.env.FRONTEND_URL);
addOriginsFromEnv(process.env.FRONTEND_URL_LOCAL);

const isAllowedOrigin = (origin) => {
  if (!origin) return true;
  if (corsOrigins.includes(origin)) return true;

  // Allow Vercel preview/production domains for the frontend app
  return /^https:\/\/[a-z0-9-]+\.vercel\.app$/i.test(origin);
};

console.log('🔐 CORS Origins Configured:', corsOrigins);
console.log('🔐 NODE_ENV:', process.env.NODE_ENV);

// Socket.IO configuration - optimized for Render
const io = socketIo(server, {
  transports: ['websocket', 'polling'],  // Prioritize WebSocket, fallback to polling
  cors: {
    origin: (origin, callback) => {
      if (isAllowedOrigin(origin)) {
        callback(null, true);
      } else {
        console.warn('❌ Socket CORS rejected origin:', origin);
        callback(new Error('Not allowed by CORS'));
      }
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
    if (isAllowedOrigin(origin)) {
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

// Security headers for cross-origin communication
app.use((req, res, next) => {
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
  res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
  next();
});

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

// Health check with DB status
app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    message: 'AI Debate Arena API is running',
    database: getDBStatus()
  });
});

app.get('/', (req, res) => {
  res.json({ message: 'Welcome to AI Debate Arena API' });
});

const upsertUserFromLogin = ({ uid, email, displayName, photoURL }) => {
  const userId = uid || `user_${Date.now()}`;
  const existingUser = users.get(userId);
  const user = existingUser || new User(displayName || 'Anonymous');

  user.id = userId;
  user.name = displayName || user.name || 'Anonymous';
  user.avatar = photoURL || user.avatar;
  user.email = email || user.email || null;
  user.photoURL = photoURL || user.photoURL || null;
  user.lastLogin = new Date().toISOString();

  users.set(userId, user);
  return user;
};

// Store incoming payloads locally in memory.
app.post("/save", async (req, res) => {
  try {
    const data = req.body; // jo data frontend se aayega

    console.log("Data received:", data); // check karne ke liye

    const savedRecord = {
      id: `payload_${Date.now()}`,
      data,
      savedAt: new Date().toISOString()
    };

    savedPayloads.push(savedRecord);

    res.json({ success: true, message: "Data saved in memory", record: savedRecord });
  } catch (error) {
    console.log(error);
    res.status(500).send("Error saving data");
  }
});

// 👇 Browser verification ke liye GET route
app.get("/save", (req, res) => {
  res.send("Please use POST method from Postman or Frontend to save data. This route is working! ✅");
});

// Persist login details to MongoDB and in-memory fallback.
app.post("/api/users/login", async (req, res) => {
  try {
    console.log('\n🔍 [LOGIN REQUEST] Received:', {
      body: req.body,
      headers: { 'content-type': req.get('content-type') }
    });

    const { uid, email, displayName, photoURL } = req.body;
    const normalizedEmail = (email || '').trim().toLowerCase();

    console.log(`📝 Parsed data: uid=${uid}, email=${email}, displayName=${displayName}`);

    if (!uid) {
      console.error('❌ Missing uid in request body');
      return res.status(400).json({ success: false, error: "User ID is required" });
    }

    if (!normalizedEmail) {
      console.error('❌ Missing email in request body');
      return res.status(400).json({ success: false, error: "Email is required" });
    }

    let savedUser = null;
    let source = 'in-memory';

    // Try to save to MongoDB first
    try {
      const dbStatus = getDBStatus();
      console.log(`🗄️ DB Status:`, dbStatus);

      if (dbStatus.connected) {
        console.log(`🔍 Upserting user by uid/email: uid=${uid}, email=${normalizedEmail}`);

        const now = new Date();
        const selector = { $or: [{ uid }, { email: normalizedEmail }] };
        const update = {
          $set: {
            uid,
            email: normalizedEmail,
            displayName,
            photoURL: photoURL || null,
            lastLogin: now,
            updatedAt: now
          },
          $setOnInsert: {
            createdAt: now
          }
        };

        let mongoUser;
        try {
          mongoUser = await MongoUser.findOneAndUpdate(selector, update, {
            new: true,
            upsert: true,
            runValidators: true,
            setDefaultsOnInsert: true
          });
        } catch (dupErr) {
          // Rare race condition guard: retry by email document id.
          if (dupErr && dupErr.code === 11000) {
            const existingByEmail = await MongoUser.findOne({ email: normalizedEmail });
            if (existingByEmail) {
              mongoUser = await MongoUser.findByIdAndUpdate(
                existingByEmail._id,
                update,
                { new: true, runValidators: true }
              );
            } else {
              throw dupErr;
            }
          } else {
            throw dupErr;
          }
        }

        savedUser = mongoUser;
        source = 'MongoDB';
        console.log(`✅ User upserted in MongoDB: ${normalizedEmail}`);
      } else {
        console.warn(`⚠️ MongoDB not connected`);
      }
    } catch (mongoError) {
      console.error(`❌ MongoDB Error:`, mongoError.message);
      console.error(`Stack:`, mongoError.stack);
    }

    // Fallback to in-memory storage
    if (!savedUser) {
      console.log(`📦 Falling back to in-memory storage`);
      const user = upsertUserFromLogin({ uid, email, displayName, photoURL });
      savedUser = user;
    }

    const response = {
      success: true,
      message: `User authenticated and stored (${source})`,
      user: {
        id: savedUser.uid || savedUser.id,
        name: savedUser.displayName || savedUser.name,
        email: savedUser.email,
        avatar: savedUser.photoURL || savedUser.avatar,
        lastLogin: savedUser.lastLogin,
        source
      }
    };

    console.log(`✅ Sending login response:`, response);
    res.json(response);
  } catch (error) {
    console.error("❌ User save error:", error.message);
    console.error("Stack:", error.stack);
    res.status(500).json({ success: false, error: "Error saving user data", details: error.message });
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

// Initialize MongoDB connection before starting server
(async () => {
  await connectDB();
  
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 AI Debate Arena Server running on port ${PORT}`);
    console.log(`📡 Socket.IO available at ws://localhost:${PORT}/socket.io/`);
    console.log(`✅ CORS enabled for: http://localhost:5173, http://localhost:5174`);
    console.log(`📊 Database Status:`, getDBStatus());
  });
})();

module.exports = { app, io };
