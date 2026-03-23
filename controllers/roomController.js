const { Room, rooms, User, users, waitingPlayers } = require('../models/index');

// Create a new room
exports.createRoom = (req, res) => {
  try {
    const { topic, maxPlayers, roomType } = req.body;
    const newRoom = new Room(topic, maxPlayers || 4, roomType || 'user-only');
    rooms.set(newRoom.code, newRoom);
    
    res.status(201).json({
      success: true,
      room: {
        code: newRoom.code,
        id: newRoom.id,
        topic: newRoom.topic,
        maxPlayers: newRoom.maxPlayers,
        roomType: newRoom.roomType,
        players: newRoom.players,
        status: newRoom.status
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// Get available rooms
exports.getAvailableRooms = (req, res) => {
  try {
    const availableRooms = Array.from(rooms.values())
      .filter(room => !room.isFull() && room.status === 'waiting')
      .map(room => ({
        code: room.code,
        id: room.id,
        topic: room.topic,
        roomType: room.roomType,
        players: room.players.length,
        maxPlayers: room.maxPlayers,
        status: room.status
      }));
    
    res.json({ success: true, rooms: availableRooms });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// Get room by code
exports.getRoomByCode = (req, res) => {
  try {
    const room = rooms.get(req.params.roomCode);
    if (!room) {
      return res.status(404).json({ success: false, error: 'Room not found' });
    }
    
    res.json({
      success: true,
      room: {
        code: room.code,
        id: room.id,
        topic: room.topic,
        roomType: room.roomType,
        players: room.players,
        maxPlayers: room.maxPlayers,
        status: room.status
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// Join room
exports.joinRoom = (req, res) => {
  try {
    const { roomCode } = req.params;
    const { userId, playerName } = req.body;
    
    const room = rooms.get(roomCode);
    if (!room) {
      return res.status(404).json({ success: false, error: 'Room not found' });
    }
    
    // Prevent joining AI debate rooms
    if (room.roomType === 'ai') {
      return res.status(403).json({ 
        success: false, 
        error: 'Cannot join AI debate rooms. Create or join user-only debate rooms.' 
      });
    }
    
    if (room.isFull()) {
      return res.status(400).json({ success: false, error: 'Room is full' });
    }
    
    let user = users.get(userId);
    if (!user) {
      user = new User(playerName);
      users.set(user.id, user);
    }
    
    room.addPlayer(user);
    
    res.json({
      success: true,
      message: 'Joined room successfully',
      room: {
        code: room.code,
        roomType: room.roomType,
        players: room.players,
        status: room.status
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// Leave room
exports.leaveRoom = (req, res) => {
  try {
    const { roomCode } = req.params;
    const { userId } = req.body;
    
    const room = rooms.get(roomCode);
    if (!room) {
      return res.status(404).json({ success: false, error: 'Room not found' });
    }
    
    room.removePlayer(userId);
    
    // Delete room if empty
    if (room.players.length === 0) {
      rooms.delete(roomCode);
    }
    
    res.json({ success: true, message: 'Left room successfully' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};


// room controller