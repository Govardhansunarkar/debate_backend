module.exports = (io) => {
  // Track debate rooms and their participants
  const debateRooms = new Map(); // { debateId: { participants: Map(userId -> {playerName, socketId}), topic, roomType } }
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

    // Join matchmaking queue
    socket.on('join-queue', (data) => {
      console.log(`${data.playerName} joined queue`);
      // Emit match-found after 3-5 seconds (demo behavior)
      setTimeout(() => {
        socket.emit('match-found', {
          debateId: `debate_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
        });
      }, 3000 + Math.random() * 2000);
    });

    // Leave matchmaking queue
    socket.on('leave-queue', (data) => {
      console.log('Player left queue');
    });

    // Join debate room
    socket.on('join-debate', (data) => {
      socket.join(data.debateId);
      
      // Initialize room if doesn't exist
      if (!debateRooms.has(data.debateId)) {
        debateRooms.set(data.debateId, { 
          participants: new Map(),
          topic: data.topic || 'Debate Topic',
          roomType: data.roomType || 'user-only'
        });
      }
      
      const room = debateRooms.get(data.debateId);
      
      // Add participant to room
      room.participants.set(data.userId, {
        playerName: data.playerName,
        socketId: socket.id,
        roomType: data.roomType || 'user-only',
        joinedAt: new Date()
      });
      
      console.log(`${data.playerName} joined debate ${data.debateId} (Topic: ${room.topic}). Total participants: ${room.participants.size}`);
      
      socket.emit('debate-joined', { 
        message: 'Joined debate successfully',
        participantCount: room.participants.size,
        topic: room.topic,
        roomType: room.roomType,
        participants: Array.from(room.participants.entries()).map(([id, info]) => ({
          userId: id,
          playerName: info.playerName
        }))
      });
      
      // Notify all participants about new participant
      io.to(data.debateId).emit('player-joined', {
        userId: data.userId,
        playerName: data.playerName,
        totalParticipants: room.participants.size,
        participants: Array.from(room.participants.entries()).map(([id, info]) => ({
          userId: id,
          playerName: info.playerName
        }))
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
