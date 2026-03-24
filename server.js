const express = require('express');
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

// Socket.IO configuration
const io = socketIo(server, {
  transports: ['websocket', 'polling'],
  cors: {
    origin: corsOrigins,
    methods: ['GET', 'POST'],
    credentials: true,
    allowEIO3: true  // Allow socket.io v3 clients
  },
  pingInterval: 10000,
  pingTimeout: 5000,
  upgradeTimeout: 10000
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

// Socket.IO
const debateSocket = require('./sockets/debateSocket');
debateSocket(io);

// Setup PeerJS Server on configurable port
// For single-port deployment, use a reverse proxy (nginx) to route /peerjs to this port
const PEERJS_PORT = process.env.PEERJS_PORT || 59000;
try {
  const peerServer = require('peerjs-server').PeerServer({ 
    port: PEERJS_PORT, 
    path: process.env.PEERJS_PATH || '/peerjs',
    debug: process.env.PEERJS_DEBUG === 'true' ? 3 : 0
  });
  console.log(`🔗 PeerJS Server configured on port ${PEERJS_PORT}`);
} catch (err) {
  console.warn(`⚠️ PeerJS Server failed to start on port ${PEERJS_PORT}:`, err.message);
  console.warn('ℹ️ Continuing without PeerJS - video features may not work');
}

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
