module.exports = (io) => {
  const { checkForMatch, checkForTeamMatch, addPlayerToQueue, removePlayerFromQueue } = require('../services/matchmakingService');
  
  // Track debate rooms and their participants
  const debateRooms = new Map(); // { debateId: { participants: Map(userId -> {playerName, socketId, team}), topic, roomType, teams } }
  const debateData = new Map(); // { debateId: { speeches: [], participants: Map } } - Track all speeches for each debate
  
  // Initialize or get debate data
  const getDebateData = (debateId) => {
    if (!debateData.has(debateId)) {
      debateData.set(debateId, {
        speeches: [],
        participantStats: {}
      });
    }
    return debateData.get(debateId);
  };

  io.on('connection', (socket) => {
    console.log('New user connected:', socket.id);

    // Join matchmaking queue for random match
    socket.on('join-queue', (data) => {
      console.log(`${data.playerName} joined queue for ${data.debateType || 'regular'}`);
      
      const player = {
        userId: data.userId,
        playerName: data.playerName,
        socketId: socket.id,
        topic: data.topic,
        debateType: data.debateType || 'regular' // 'regular' or 'team'
      };
      
      addPlayerToQueue(player);
      socket.emit('queued', { position: data.position, topic: data.topic });

      // Start a timer to auto-match with AI if no user joins within 30 seconds
      const aiTimeout = setTimeout(() => {
        // Only if player is still in queue
        const status = require('../services/matchmakingService').getMatchmakingStatus();
        const isInQueue = status.waitingCount > 0 && status.players.some(p => p.userId === data.userId);
        
        if (isInQueue) {
          console.log(`🤖 Auto-matching ${data.playerName} with AI (Queue Timeout)`);
          removePlayerFromQueue(data.userId);
          
          const debateId = `debate_ai_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
          socket.emit('match-found', {
            debateId: debateId,
            matchType: 'ai',
            topic: data.topic || "Random Debate",
            debateType: 'ai-debate'
          });
        }
      }, 30000); // 30 seconds wait then AI match
      
      // Check for team match first (priority)
      const teamMatch = checkForTeamMatch();
      if (teamMatch.canMatch) {
        clearTimeout(aiTimeout);
        console.log(`🎯 Team Match Found! ${teamMatch.teamSize}`);
        
        const debateId = `debate_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        
        // Notify all matched players
        const allTeamPlayers = [
          ...teamMatch.teams.teamFor.players,
          ...teamMatch.teams.teamAgainst.players
        ];
        
        allTeamPlayers.forEach(player => {
          io.to(player.socketId).emit('match-found', {
            debateId: debateId,
            matchType: 'team',
            teamSize: teamMatch.teamSize,
            topic: player.topic,
            debateType: 'team-debate',
            teamAssignment: 
              teamMatch.teams.teamFor.players.some(p => p.userId === player.userId)
                ? { teamName: 'TEAM FOR', position: 'FOR' }
                : { teamName: 'TEAM AGAINST', position: 'AGAINST' },
            allPlayers: allTeamPlayers.map(p => ({ userId: p.userId, playerName: p.playerName }))
          });
        });
        return;
      }
      
      // Check for regular 1v1 match (secondary)
      const regularMatch = checkForMatch();
      if (regularMatch.canMatch) {
        console.log(`✅ Regular Match Found! 1v1`);
        
        const debateId = `debate_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        
        regularMatch.players.forEach(player => {
          io.to(player.socketId).emit('match-found', {
            debateId: debateId,
            matchType: 'regular',
            topic: player.topic,
            debateType: 'user-only'
          });
        });
      }
    });

    // Leave matchmaking queue
    socket.on('leave-queue', (data) => {
      removePlayerFromQueue(data.userId);
      console.log('Player left queue');
    });

    // Join debate room (for team or regular debates)
    socket.on('join-debate', (data) => {
      socket.join(data.debateId);
      
      // Initialize room if doesn't exist
      if (!debateRooms.has(data.debateId)) {
        debateRooms.set(data.debateId, { 
          participants: new Map(),
          topic: data.topic || 'Debate Topic',
          roomType: data.roomType || 'user-only',
          debateType: data.debateType || 'user-only',
          teams: data.teams ? { // For team debates
            teamFor: { position: 'FOR', players: data.teams.teamFor || [] },
            teamAgainst: { position: 'AGAINST', players: data.teams.teamAgainst || [] }
          } : null,
          currentSpeaker: null,
          turnOrder: [], // For team debates: alternating team speakers
          currentTurnIndex: 0
        });
      }
      
      const room = debateRooms.get(data.debateId);
      
      // Add participant to room with team info
      room.participants.set(data.userId, {
        playerName: data.playerName,
        socketId: socket.id,
        roomType: data.roomType || 'user-only',
        debateType: data.debateType || data.roomType || 'user-only',
        team: data.team || null, // For team debates: 'FOR' or 'AGAINST'
        joinedAt: new Date()
      });
      
      console.log(`${data.playerName} joined debate ${data.debateId} (Type: ${room.debateType}). Total: ${room.participants.size}`);
      
      // Build turn order for team debates
      if (room.debateType === 'team-debate' && room.turnOrder.length === 0) {
        const teamForPlayers = Array.from(room.participants.entries())
          .filter(([id, info]) => info.team === 'FOR')
          .map(([id]) => id);
        const teamAgainstPlayers = Array.from(room.participants.entries())
          .filter(([id, info]) => info.team === 'AGAINST')
          .map(([id]) => id);
        
        // Build alternating turn order: FOR, AGAINST, FOR, AGAINST...
        const maxTurns = Math.max(teamForPlayers.length, teamAgainstPlayers.length);
        for (let i = 0; i < maxTurns; i++) {
          if (i < teamForPlayers.length) room.turnOrder.push(teamForPlayers[i]);
          if (i < teamAgainstPlayers.length) room.turnOrder.push(teamAgainstPlayers[i]);
        }
      }
      
      socket.emit('debate-joined', { 
        message: 'Joined debate successfully',
        participantCount: room.participants.size,
        topic: room.topic,
        roomType: room.roomType,
        debateType: room.debateType,
        teams: room.teams,
        turnOrder: room.turnOrder,
        participants: Array.from(room.participants.entries()).map(([id, info]) => ({
          userId: id,
          playerName: info.playerName,
          team: info.team
        }))
      });
      
      // Notify all participants
      io.to(data.debateId).emit('player-joined', {
        userId: data.userId,
        playerName: data.playerName,
        team: data.team || null,
        totalParticipants: room.participants.size,
        debateType: room.debateType,
        participants: Array.from(room.participants.entries()).map(([id, info]) => ({
          userId: id,
          playerName: info.playerName,
          team: info.team
        })),
        turnOrder: room.turnOrder
      });
    });

    // Send message
    socket.on('send-message', (data) => {
      io.to(data.debateId).emit('receive-message', {
        userId: data.userId,
        playerName: data.playerName,
        text: data.text,
        timestamp: new Date()
      });
    });

    // Raise hand
    socket.on('raise-hand', (data) => {
      io.to(data.debateId).emit('hand-raised', {
        userId: data.userId,
        playerName: data.playerName
      });
    });

    // Lower hand
    socket.on('lower-hand', (data) => {
      io.to(data.debateId).emit('hand-lowered', {
        userId: data.userId,
        playerName: data.playerName
      });
    });

    // Debate timer update
    socket.on('timer-update', (data) => {
      io.to(data.debateId).emit('timer-updated', {
        timeRemaining: data.timeRemaining
      });
    });

    // Start debate signal - admin only
    socket.on('start-debate', (data) => {
      const room = debateRooms.get(data.debateId);
      if (room) {
        room.isActive = true;
        room.startTime = new Date();
        
        // Simple turn logic for regular 1v1: Admin speaks first
        const participants = Array.from(room.participants.keys());
        if (participants.length > 1) {
          room.currentSpeaker = participants[0]; // Admin (first person to join)
          room.turnOrder = participants;
        }

        io.to(data.debateId).emit('debate-started', {
          startTime: room.startTime,
          currentSpeaker: room.currentSpeaker,
          turnOrder: room.turnOrder,
          topic: room.topic
        });
      }
    });

    // End debate - store final data
    socket.on('end-debate', (data) => {
      console.log(`[Debate End] Ending debate: ${data.debateId}`);
      
      const debateData_local = getDebateData(data.debateId);
      debateData_local.endTime = new Date();
      
      // Broadcast final stats to all participants
      io.to(data.debateId).emit('debate-stats', {
        totalSpeeches: debateData_local.speeches.length,
        participantCount: Object.keys(debateData_local.participantStats).length,
        participantStats: debateData_local.participantStats
      });
      
      io.to(data.debateId).emit('debate-ended', {
        message: 'Debate has ended'
      });
      
      // Clean up room
      if (debateRooms.has(data.debateId)) {
        debateRooms.delete(data.debateId);
      }
      
      // Keep debateData for 1 hour then auto-cleanup
      setTimeout(() => {
        if (debateData.has(data.debateId)) {
          console.log(`[Cleanup] Auto-removing debate data: ${data.debateId}`);
          debateData.delete(data.debateId);
        }
      }, 3600000); // 1 hour
    });

    // Player left debate
    socket.on('player-left', (data) => {
      const room = debateRooms.get(data.debateId);
      if (room) {
        room.participants.delete(data.userId);
        console.log(`${data.playerName} left debate: ${data.debateId}. Remaining participants: ${room.participants.size}`);
      }
      
      io.to(data.debateId).emit('player-disconnected', {
        userId: data.userId,
        playerName: data.playerName,
        message: `${data.playerName} left the debate`,
        remainingParticipants: room ? room.participants.size : 0
      });
    });

    // Video ready - user is ready to stream video
    socket.on('video-ready', (data) => {
      // Broadcast to all participants in the room
      io.to(data.debateId).emit('video-ready', {
        userId: data.userId,
        playerName: data.playerName,
        timestamp: new Date()
      });
      
      console.log(`[Video] ${data.playerName} (${data.userId}) video ready in ${data.debateId}`);
    });

    // Video state change - camera/mic toggled
    socket.on('video-state-change', (data) => {
      io.to(data.debateId).emit('video-state-changed', {
        userId: data.userId,
        playerName: data.playerName,
        cameraOn: data.cameraOn,
        micOn: data.micOn,
        timestamp: new Date()
      });
      
      console.log(`[Video State] ${data.playerName} - Camera: ${data.cameraOn ? '✓' : '✗'}, Mic: ${data.micOn ? '✓' : '✗'}`);
    });

    // Request fresh participant list with video status
    socket.on('request-participants', (data) => {
      const room = debateRooms.get(data.debateId);
      if (room) {
        const participants = Array.from(room.participants.entries()).map(([id, info]) => ({
          userId: id,
          playerName: info.playerName,
          joinedAt: info.joinedAt
        }));
        socket.emit('participants-list', {
          participants: participants,
          count: participants.length,
          topic: room.topic,
          roomType: room.roomType
        });
      }
    });

    // User speech - broadcast to all participants in debate room
    socket.on('user-speech', (data) => {
      console.log(`[Speech] ${data.playerName} spoke in debate ${data.debateId}`);
      
      // Store speech on backend for AI analysis later
      const debateData_local = getDebateData(data.debateId);
      const speechData = {
        userId: data.userId,
        playerName: data.playerName,
        speech: data.speech,
        points: data.points,
        qualityScore: data.qualityScore,
        duration: data.duration || 0,
        wordCount: data.speech ? data.speech.split(' ').length : 0,
        timestamp: new Date()
      };
      
      debateData_local.speeches.push(speechData);
      
      // Update participant stats
      if (!debateData_local.participantStats[data.userId]) {
        debateData_local.participantStats[data.userId] = {
          playerName: data.playerName,
          totalSpeeches: 0,
          totalPoints: 0,
          totalWords: 0,
          speeches: []
        };
      }
      
      const stats = debateData_local.participantStats[data.userId];
      stats.totalSpeeches += 1;
      stats.totalPoints += (data.points || 0);
      stats.totalWords += (speechData.wordCount || 0);
      stats.speeches.push(speechData);
      
      console.log(`[Debate Stats] Total speeches: ${debateData_local.speeches.length}, Participants: ${Object.keys(debateData_local.participantStats).length}`);
      
      // Broadcast to all participants
      io.to(data.debateId).emit('speech-received', {
        userId: data.userId,
        playerName: data.playerName || 'Unknown Player',
        speech: data.speech,
        points: data.points,
        qualityScore: data.qualityScore,
        timestamp: new Date()
      });
    });

    // Handle disconnection
    socket.on('disconnect', () => {
      console.log('User disconnected:', socket.id);
      
      // Find and remove user from all rooms
      debateRooms.forEach((room, debateId) => {
        for (const [userId, participant] of room.participants) {
          if (participant.socketId === socket.id) {
            room.participants.delete(userId);
            
            io.to(debateId).emit('player-disconnected', {
              userId: userId,
              playerName: participant.playerName,
              message: `${participant.playerName} disconnected`,
              remainingParticipants: room.participants.size
            });
            
            console.log(`${participant.playerName} disconnected from ${debateId}`);
            break;
          }
        }
        
        // Clean up empty rooms
        if (room.participants.size === 0) {
          debateRooms.delete(debateId);
        }
      });
    });
  });
};
