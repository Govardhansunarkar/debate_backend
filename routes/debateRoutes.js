const express = require('express');
const router = express.Router();
const debateController = require('../controllers/debateController');

// IMPORTANT: Specific routes MUST come before generic :debateId routes
router.post('/analyze-openai', debateController.analyzeWithOpenAI);
router.post('/analyze-gemini', debateController.analyzeWithGemini);
router.post('/analyze-multi-participant', debateController.analyzeMultiParticipant);
router.post('/ai-response', debateController.getAIResponse);
router.post('/validate-topic', debateController.validateTopic);  // NEW: Validate topic

// Generic debate routes
router.post('/', debateController.startDebate);
router.get('/:debateId', debateController.getDebate);
router.post('/:debateId/end', debateController.endDebate);
router.get('/:debateId/results', debateController.getResults);
router.post('/:debateId/ai-feedback', debateController.getAIFeedback);

module.exports = router;
