const { User, users } = require('../models/index');

// Create user
exports.createUser = (req, res) => {
  try {
    const { name } = req.body;
    const user = new User(name);
    users.set(user.id, user);
    
    res.status(201).json({
      success: true,
      user: {
        id: user.id,
        name: user.name,
        avatar: user.avatar,
        rating: user.rating
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// Get user
exports.getUser = (req, res) => {
  try {
    const user = users.get(req.params.userId);
    if (!user) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }
    
    res.json({
      success: true,
      user: {
        id: user.id,
        name: user.name,
        avatar: user.avatar,
        rating: user.rating,
        debatesPlayed: user.debatesPlayed
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// Get user history
exports.getUserHistory = (req, res) => {
  try {
    const user = users.get(req.params.userId);
    if (!user) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }
    
    res.json({
      success: true,
      history: {
        userId: user.id,
        debatesPlayed: user.debatesPlayed,
        rating: user.rating,
        joinedAt: user.createdAt
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};
