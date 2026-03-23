module.exports = {
  PORT: process.env.PORT || 8000,
  NODE_ENV: process.env.NODE_ENV || 'development',
  DEBUG: true,
  
  // Debate Settings
  DEBATE_DURATION: parseInt(process.env.DEBATE_DURATION) || 300, // 5 minutes
  MAX_PLAYERS_PER_ROOM: parseInt(process.env.MAX_PLAYERS_PER_ROOM) || 4,
  MIN_PLAYERS_FOR_DEBATE: parseInt(process.env.MIN_PLAYERS_FOR_DEBATE) || 2,
  
  // AI Services
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  GEMINI_API_KEY: process.env.GEMINI_API_KEY,
  
  // JWT
  JWT_SECRET: process.env.JWT_SECRET || 'your-secret-key',
  
  // CORS
  CORS_ORIGINS: [
    'http://localhost:5173',
    'http://localhost:3000',
    'http://127.0.0.1:5173',
    'http://127.0.0.1:3000'
  ]
};
