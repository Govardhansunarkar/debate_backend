const express = require('express');
const router = express.Router();
const userController = require('../controllers/userController');

// User routes
router.post('/', userController.createUser);
router.get('/:userId', userController.getUser);
router.get('/:userId/history', userController.getUserHistory);

module.exports = router;
