const express = require('express');
const router = express.Router();
const roomController = require('../controllers/roomController');

// Room routes
router.post('/', roomController.createRoom);
router.get('/', roomController.getAvailableRooms);
router.get('/:roomCode', roomController.getRoomByCode);
router.post('/:roomCode/join', roomController.joinRoom);
router.post('/:roomCode/leave', roomController.leaveRoom);

module.exports = router;
