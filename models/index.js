const { v4: uuidv4 } = require('uuid');

// In-memory storage (can be replaced with database later)
const rooms = new Map();
const debates = new Map();
const users = new Map();
const waitingPlayers = [];

// Room Model
class Room {
  constructor(topic = null, maxPlayers = 4, roomType = 'user-only') {
    this.id = uuidv4();
    this.code = generateRoomCode();
    this.topic = topic;
    this.maxPlayers = maxPlayers;
    this.roomType = roomType; // 'ai' for AI debates, 'user-only' for user vs user
    this.players = [];
    this.status = 'waiting'; // waiting, active, completed
    this.createdAt = new Date();
  }

  addPlayer(player) {
    if (this.players.length < this.maxPlayers) {
      this.players.push(player);
      return true;
    }
    return false;
  }

  removePlayer(playerId) {
    this.players = this.players.filter(p => p.id !== playerId);
  }

  isFull() {
    return this.players.length >= this.maxPlayers;
  }
}

// Debate Model
class Debate {
  constructor(roomId, topic, players, roomType = 'user-only') {
    this.id = uuidv4();
    this.roomId = roomId;
    this.topic = topic;
    this.players = players;
    this.roomType = roomType; // 'ai' for AI debates, 'user-only' for user vs user
    this.messages = [];
    this.speeches = []; // Track ALL speeches from all participants
    this.participantStats = {}; // { userId: { totalSpeeches, totalPoints, avgPoints, avgWordCount } }
    this.status = 'active'; // active, completed
    this.startTime = new Date();
    this.endTime = null;
    this.duration = 0;
    this.scores = {};
    
    players.forEach(player => {
      this.scores[player.id] = {
        communication: 0,
        logic: 0,
        confidence: 0,
        rebuttal: 0
      };
      this.participantStats[player.id] = {
        playerName: player.name,
        totalSpeeches: 0,
        totalPoints: 0,
        totalWords: 0,
        totalDuration: 0,
        speeches: []
      };
    });
  }

  addMessage(userId, message) {
    this.messages.push({
      userId,
      message,
      timestamp: new Date()
    });
  }

  // NEW: Track all speeches for AI analysis
  addSpeech(userId, playerName, speechText, points, qualityScore, duration) {
    const wordCount = speechText.split(' ').length;
    const speech = {
      userId,
      playerName,
      text: speechText,
      points,
      qualityScore,
      duration,
      wordCount,
      timestamp: new Date()
    };
    
    this.speeches.push(speech);
    
    // Update participant stats
    if (this.participantStats[userId]) {
      const stats = this.participantStats[userId];
      stats.totalSpeeches += 1;
      stats.totalPoints += points;
      stats.totalWords += wordCount;
      stats.totalDuration += duration;
      stats.speeches.push(speech);
    }
    
    console.log(`[Debate] Speech added: ${playerName} | Total speeches: ${this.speeches.length}`);
  }

  // NEW: Get unified transcript for AI analysis
  getUnifiedTranscript() {
    return this.speeches.map((speech, idx) => ({
      index: idx + 1,
      speaker: speech.playerName,
      text: speech.text,
      wordCount: speech.wordCount,
      points: speech.points,
      qualityScore: speech.qualityScore
    })).sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
  }

  // NEW: Get all participant performance stats
  getParticipantStats() {
    return Object.entries(this.participantStats).map(([userId, stats]) => ({
      userId,
      playerName: stats.playerName,
      totalSpeeches: stats.totalSpeeches,
      totalPoints: stats.totalPoints,
      averagePointsPerSpeech: stats.totalSpeeches > 0 ? (stats.totalPoints / stats.totalSpeeches).toFixed(2) : 0,
      averageWordsPerSpeech: stats.totalSpeeches > 0 ? (stats.totalWords / stats.totalSpeeches).toFixed(0) : 0,
      totalWords: stats.totalWords,
      totalDuration: stats.totalDuration
    }));
  }

  setScores(userId, scores) {
    if (this.scores[userId]) {
      this.scores[userId] = scores;
    }
  }

  endDebate() {
    this.endTime = new Date();
    this.duration = (this.endTime - this.startTime) / 1000; // in seconds
    this.status = 'completed';
  }
}

// User Model
class User {
  constructor(name = 'Anonymous') {
    this.id = uuidv4();
    this.name = name;
    this.avatar = generateAvatar(name);
    this.rating = 1000;
    this.debatesPlayed = 0;
    this.createdAt = new Date();
  }
}

module.exports = {
  Room,
  Debate,
  User,
  rooms,
  debates,
  users,
  waitingPlayers
};

// Helper functions (will be in utils folder)
function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

function generateAvatar(name) {
  const colors = ['FF6B6B', '4ECDC4', '45B7D1', 'FFA07A', '98D8C8'];
  const initials = name.split(' ').map(n => n[0]).join('').toUpperCase();
  const randomColor = colors[Math.floor(Math.random() * colors.length)];
  return `https://ui-avatars.com/api/?name=${initials}&background=${randomColor}&color=fff`;
}
