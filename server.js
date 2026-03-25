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

// Socket.IO configuration - optimized for Render
const io = socketIo(server, {
  transports: ['websocket', 'polling'],  // Try websocket first, fallback to polling
  cors: {
    origin: corsOrigins,
    methods: ['GET', 'POST'],
    credentials: true,
    allowEIO3: true  // Allow socket.io v3 clients
  },
  // Aggressive timeouts for Render free tier (very slow platform)
  pingInterval: 60000,   // 60 seconds - long interval
  pingTimeout: 40000,    // 40 seconds - plenty of time for response
  upgradeTimeout: 60000, // 60 seconds - protocol upgrade timeout
  maxHttpBufferSize: 1e6, // 1MB buffer
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
