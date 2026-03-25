const { waitingPlayers, User } = require('../models/index');

const MIN_PLAYERS_FOR_MATCH = 2;
const TEAM_MATCH_SIZE = 4; // 2v2
const TEAM_MATCH_SIZE_LARGE = 6; // 3v3

// Add player to waiting queue
const addPlayerToQueue = (player) => {
  waitingPlayers.push(player);
  return { queued: true, position: waitingPlayers.length };
};

// Remove player from queue
const removePlayerFromQueue = (userId) => {
  const index = waitingPlayers.findIndex(p => p.userId === userId);
  if (index !== -1) {
    waitingPlayers.splice(index, 1);
    return { removed: true };
  }
  return { removed: false };
};

// Check if we can create a regular 1v1 match (2 players)
const checkForMatch = () => {
  if (waitingPlayers.length >= MIN_PLAYERS_FOR_MATCH && waitingPlayers.length < TEAM_MATCH_SIZE) {
    const matchPlayers = waitingPlayers.splice(0, MIN_PLAYERS_FOR_MATCH);
    return {
      canMatch: true,
      players: matchPlayers,
      matchType: 'regular', // 1v1
      debateType: 'user-only'
    };
  }
  return { canMatch: false };
};

// Check if we can create a team match (4+ players)
const checkForTeamMatch = () => {
  // For 4-5 players: create 2v2 with 5th waiting
  if (waitingPlayers.length >= TEAM_MATCH_SIZE && waitingPlayers.length < TEAM_MATCH_SIZE_LARGE) {
    const teamAPlayers = waitingPlayers.splice(0, 2); // First 2 players
    const teamBPlayers = waitingPlayers.splice(0, 2); // Next 2 players
    
    return {
      canMatch: true,
      teams: {
        teamFor: { position: 'FOR', players: teamAPlayers },
        teamAgainst: { position: 'AGAINST', players: teamBPlayers }
      },
      matchType: 'team',
      teamSize: '2v2',
      debateType: 'team-debate'
    };
  }
  
  // For 6+ players: create 3v3
  if (waitingPlayers.length >= TEAM_MATCH_SIZE_LARGE) {
    const teamAPlayers = waitingPlayers.splice(0, 3); // First 3 players
    const teamBPlayers = waitingPlayers.splice(0, 3); // Next 3 players
    
    return {
      canMatch: true,
      teams: {
        teamFor: { position: 'FOR', players: teamAPlayers },
        teamAgainst: { position: 'AGAINST', players: teamBPlayers }
      },
      matchType: 'team',
      teamSize: '3v3',
      debateType: 'team-debate'
    };
  }
  
  return { canMatch: false };
};

// Get matchmaking status
const getMatchmakingStatus = () => {
  let nextMatchType = 'none';
  if (waitingPlayers.length >= TEAM_MATCH_SIZE_LARGE) {
    nextMatchType = 'team-3v3';
  } else if (waitingPlayers.length >= TEAM_MATCH_SIZE) {
    nextMatchType = 'team-2v2';
  } else if (waitingPlayers.length >= MIN_PLAYERS_FOR_MATCH) {
    nextMatchType = 'regular-1v1';
  }
  
  return {
    playersWaiting: waitingPlayers.length,
    estimatedWaitTime: waitingPlayers.length > 0 ? Math.random() * 30 : 0,
    nextMatchType: nextMatchType
  };
};

module.exports = {
  addPlayerToQueue,
  removePlayerFromQueue,
  checkForMatch,
  checkForTeamMatch,
  getMatchmakingStatus
};
