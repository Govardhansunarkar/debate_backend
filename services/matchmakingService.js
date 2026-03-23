const { waitingPlayers, User } = require('../models/index');

const MIN_PLAYERS_FOR_MATCH = 2;
const MAX_PLAYERS_FOR_MATCH = 4;

// Add player to waiting queue
const addPlayerToQueue = (player) => {
  waitingPlayers.push(player);
  return { queued: true, position: waitingPlayers.length };
};

// Check if we can create a match
const checkForMatch = () => {
  if (waitingPlayers.length >= MIN_PLAYERS_FOR_MATCH) {
    const matchPlayers = waitingPlayers.splice(0, MIN_PLAYERS_FOR_MATCH);
    return {
      canMatch: true,
      players: matchPlayers
    };
  }
  return { canMatch: false };
};

// Get matchmaking status
const getMatchmakingStatus = () => {
  return {
    playersWaiting: waitingPlayers.length,
    estimatedWaitTime: waitingPlayers.length > 0 ? Math.random() * 30 : 0
  };
};

module.exports = {
  addPlayerToQueue,
  checkForMatch,
  getMatchmakingStatus
};
