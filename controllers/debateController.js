const axios = require('axios');
const { Debate, debates, rooms } = require('../models/index');
const { analyzeDebateArgument } = require('../utils/debateArgumentAnalysis');
const { calculateQualityBasedPoints } = require('../utils/advancedScoringSystem');

// =====================================================
// NVIDIA API Integration Function (works with Nemotron models)
// =====================================================
const callNvidiaAPI = async (prompt, apiKey, apiUrl, model) => {
  try {
    console.log('[NVIDIA] ===== NVIDIA API CALL START =====');
    console.log('[NVIDIA] Model:', model);
    console.log('[NVIDIA] API Key provided:', apiKey ? `yes (${apiKey.substring(0, 20)}...)` : 'NO - MISSING!');
    console.log('[NVIDIA] API URL:', apiUrl);
    
    if (!apiKey) {
      throw new Error('NVIDIA_API_KEY is not set in environment variables');
    }
    
    // Ensure we have the full endpoint URL
    const endpoint = apiUrl.includes('/chat/completions') 
      ? apiUrl 
      : (apiUrl.replace(/\/$/, '') + '/chat/completions');
    
    console.log('[NVIDIA] Full endpoint:', endpoint);
    
    const requestBody = {
      model: model,
      messages: [
        { 
          role: 'system', 
          content: 'You are a debate participant. Provide counter-arguments in 2-3 sentences. Be respectful but firm.'
        },
        { 
          role: 'user', 
          content: prompt 
        }
      ],
      max_tokens: 800,
      temperature: 0.65,
      top_p: 0.90
    };
    
    console.log('[NVIDIA] Sending request...');
    
    const response = await axios.post(
      endpoint,
      requestBody,
      {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        timeout: 0  // No timeout - NVIDIA will respond whenever it's ready
      }
    );

    console.log('[NVIDIA] ✅ Response status:', response.status);
    
    // Extract the message content from the response
    let aiResponse = '';
    if (response.data?.choices?.[0]?.message) {
      const message = response.data.choices[0].message;
      aiResponse = (message.content || message.text || JSON.stringify(message)).trim();
    }
    
    if (!aiResponse || aiResponse.startsWith('{')) {
      console.error('[NVIDIA] ❌ Parsing error. Message object:', response.data?.choices?.[0]?.message);
      throw new Error('Could not parse NVIDIA response');
    }
    
    console.log('[NVIDIA] ✅ Response received successfully');
    console.log('[NVIDIA] ===== NVIDIA API CALL SUCCESS =====');
    return aiResponse;
  } catch (error) {
    console.error('[NVIDIA] ❌ ===== NVIDIA API ERROR =====');
    console.error('[NVIDIA] Error message:', error.message);
    console.error('[NVIDIA] Error code:', error.code);
    
    if (error.response) {
      console.error('[NVIDIA] HTTP Status:', error.response.status);
      console.error('[NVIDIA] Status Text:', error.response.statusText);
      console.error('[NVIDIA] Response data:', JSON.stringify(error.response.data).substring(0, 200));
    } else if (error.request) {
      console.error('[NVIDIA] No response received (network error)');
      console.error('[NVIDIA] Request details:', error.request?.method, error.request?.path);
    } else {
      console.error('[NVIDIA] Error during request setup:', error.message);
    }
    
    console.error('[NVIDIA] ===== NVIDIA API FAILED =====');
    throw error;
  }
};

// Start a debate
exports.startDebate = (req, res) => {
  try {
    const { roomCode, topic, players } = req.body;
    
    console.log('[startDebate] Received request:', { roomCode, topic, playersCount: players?.length });
    console.log('[startDebate] Rooms in storage:', Array.from(rooms.keys()));
    
    const room = rooms.get(roomCode);
    if (!room) {
      console.error('[startDebate] Room not found with code:', roomCode);
      return res.status(404).json({ success: false, error: 'Room not found', receivedCode: roomCode, availableCodes: Array.from(rooms.keys()) });
    }
    
    console.log('[startDebate] Found room:', room.code);
    
    const debate = new Debate(room.id, topic, players);
    debates.set(debate.id, debate);
    room.status = 'active';
    
    console.log('[startDebate] Debate created:', debate.id);
    
    res.status(201).json({
      success: true,
      debate: {
        id: debate.id,
        topic: debate.topic,
        players: debate.players,
        status: debate.status,
        startTime: debate.startTime
      }
    });
  } catch (error) {
    console.error('[startDebate] Error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// Get debate
exports.getDebate = (req, res) => {
  try {
    const debate = debates.get(req.params.debateId);
    if (!debate) {
      return res.status(404).json({ success: false, error: 'Debate not found' });
    }
    
    res.json({
      success: true,
      debate: {
        id: debate.id,
        topic: debate.topic,
        players: debate.players,
        status: debate.status,
        messages: debate.messages,
        scores: debate.scores
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// End debate
exports.endDebate = (req, res) => {
  try {
    const debate = debates.get(req.params.debateId);
    if (!debate) {
      return res.status(404).json({ success: false, error: 'Debate not found' });
    }
    
    debate.status = 'completed';
    debate.endTime = new Date();
    
    res.json({
      success: true,
      message: 'Debate ended',
      debate: {
        id: debate.id,
        status: debate.status,
        endTime: debate.endTime
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// Get results
exports.getResults = (req, res) => {
  try {
    const debate = debates.get(req.params.debateId);
    if (!debate) {
      return res.status(404).json({ success: false, error: 'Debate not found' });
    }
    
    res.json({
      success: true,
      results: {
        debateId: debate.id,
        topic: debate.topic,
        duration: debate.endTime ? debate.endTime - debate.startTime : null,
        scores: debate.scores,
        messageCount: debate.messages.length
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// Get AI Feedback
exports.getAIFeedback = (req, res) => {
  try {
    const debate = debates.get(req.params.debateId);
    if (!debate) {
      return res.status(404).json({ success: false, error: 'Debate not found' });
    }
    
    // Placeholder for AI feedback
    const feedback = {
      debateId: debate.id,
      timestamp: new Date(),
      feedback: {
        communication: {
          score: 75,
          comment: 'Good clarity and articulation'
        },
        logic: {
          score: 80,
          comment: 'Strong logical arguments'
        },
        confidence: {
          score: 70,
          comment: 'Good confidence overall'
        },
        rebuttal: {
          score: 65,
          comment: 'Room for improvement in counter-arguments'
        }
      },
      suggestions: [
        'Use more specific examples',
        'Improve response time to counter-arguments',
        'Build stronger closing statements'
      ]
    };
    
    res.json({ success: true, feedback });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// Analyze debate with NVIDIA LLM (tracks debate history and provides AI feedback)
exports.analyzeWithOpenAI = async (req, res) => {
  try {
    const { speeches, topic } = req.body;

    // Validate input
    if (!speeches || !Array.isArray(speeches) || speeches.length === 0) {
      return res.status(400).json({ 
        success: false, 
        error: "Speeches must be a non-empty array",
        received: { speeches: speeches?.length || 'null' }
      });
    }

    if (!topic) {
      return res.status(400).json({ success: false, error: "Topic is required" });
    }

    const nvidiaApiKey = process.env.NVIDIA_API_KEY;
    const nvidiaApiUrl = process.env.NVIDIA_API_URL || 'https://integrate.api.nvidia.com/v1';
    const nvidiaModel = process.env.NVIDIA_MODEL || 'nvidia/nemotron-3-super-120b-a12b';

    // Filter user speeches (speaker === "user")
    const userSpeeches = speeches.filter(s => s.speaker === 'user').map(s => s.text).join('\n\n');
    
    // Format all speeches with alternating speaker labels for context
    const speechText = speeches
      .map((s, idx) => {
        const speaker = s.speaker === 'user' ? '👤 YOU' : '🤖 OPPONENT';
        return `${speaker} (Speech ${idx + 1}): ${s.text}`;
      })
      .join("\n\n");

    const feedbackPrompt = `You are a friendly debate coach helping beginner debaters improve. You explain things in simple, easy-to-understand language.

Review this debate on the topic: "${topic}"

DEBATE TRANSCRIPT:
${speechText}

---

Analyze THE USER'S ARGUMENTS (marked as 👤 YOU) and give feedback that a beginner can understand and use.

IMPORTANT GRADING INSTRUCTIONS:
Calculate a grade for the user based on these factors ONLY:
- Did they explain their idea clearly? (0-2 points)
- Did they use examples or real stories? (0-2 points)
- Did they answer what the other person said? (0-2 points)
- Did their arguments make sense together? (0-2 points)
- Were they easy to understand? (0-2 points)

Total score = sum of all factors (scale 1-10)
DO NOT give everyone 7.5! Look at what they actually did.

IMPORTANT: Use simple, friendly language. Avoid complex terms. Explain like you're talking to a friend!

Provide feedback in this exact JSON structure:

{
  "overall_score": <CALCULATED number 1-10 based on the 5 factors above>,
  "summary": "<1-2 simple sentences about how they did>",
  "strengths": [
    "<easy explanation of what was good - mention a specific thing they said>",
    "<easy explanation of what was good - mention a specific thing they said>",
    "<easy explanation of what was good - mention a specific thing they said>"
  ],
  "weaknesses": [
    "<easy explanation of what to work on>",
    "<easy explanation of what to work on>",
    "<easy explanation of what to work on>"
  ],
  "key_points": [
    "<their best argument in simple terms>",
    "<another good point they made>",
    "<another thing they said well>"
  ],
  "recommendations": [
    "<simple tip they can try next time>",
    "<simple tip they can try next time>",
    "<simple tip they can try next time>"
  ]
}

SCORING EXAMPLES:
- Score 9-10: Clear explanations + good examples + answered all points + arguments made sense + easy to follow
- Score 7-8: Mostly clear + some examples + answered some points + mostly made sense + mostly easy to follow
- Score 5-6: Somewhat clear + few examples + answered few points + some confusion + hard to follow sometimes
- Score 3-4: Not very clear + no examples + didn't answer points + confusing logic + hard to follow
- Score 1-2: Very unclear + no examples + ignored opponent + no logic + very hard to follow

Return ONLY valid JSON, no markdown or extra text.`;


    try {
      if (nvidiaApiKey) {
        // Use NVIDIA LLM for analysis
        console.log('[analyzeWithOpenAI] ✅ Using NVIDIA LLM for feedback analysis');
        
        // Construct proper endpoint URL
        const endpoint = `${nvidiaApiUrl.replace(/\/chat\/completions$/, '')}/chat/completions`;
        console.log('[analyzeWithOpenAI] 📍 Calling endpoint:', endpoint);
        
        const nvidiaResponse = await axios.post(
          endpoint,
          {
            model: nvidiaModel,
            messages: [
              {
                role: 'system',
                content: `You are a friendly and encouraging debate coach. You help beginner debaters by giving simple, easy-to-understand feedback and keep response in 2-3 lines only. 
                
You explain things clearly without using confusing terms. Your goal is to:
1. Make the person feel good about what they did well
2. Give them specific, easy tips to improve
3. Use simple language that anyone can understand
4. Be encouraging and supportive

Remember: You're talking to beginners, so keep it simple and friendly!`
              },
              {
                role: 'user',
                content: feedbackPrompt
              }
            ],
            max_tokens: 1500,
            temperature: 0.7,
            top_p: 0.95
          },
          {
            headers: {
              'Authorization': `Bearer ${nvidiaApiKey}`,
              'Content-Type': 'application/json'
            },
            timeout: 0  // No timeout - wait for NVIDIA
          }
        );

        const analysisText = nvidiaResponse.data?.choices?.[0]?.message?.content;
        console.log('[analyzeWithOpenAI] ✅ NVIDIA Response received (length:', analysisText?.length, 'chars)');
        console.log('[analyzeWithOpenAI] Response sample:', analysisText?.substring(0, 150));

        if (!analysisText) {
          throw new Error('No analysis text from NVIDIA');
        }

        // Parse JSON response
        let analysis = JSON.parse(analysisText);
        console.log('[analyzeWithOpenAI] ✅ JSON parsed successfully. Score:', analysis.overall_score);
        
        res.json({ 
          success: true, 
          analysis,
          source: 'NVIDIA_LLM',
          timestamp: new Date().toISOString()
        });
      } else {
        throw new Error('NVIDIA API key not configured');
      }

  } catch (error) {
    console.error('[analyzeWithOpenAI] Error:', error.message);
    res.status(500).json({ 
      success: false, 
      error: error.message,
      source: 'ERROR'
    });
  }
};

// Analyze debate with Gemini (also uses NVIDIA LLM for consistency)
exports.analyzeWithGemini = async (req, res) => {
  try {
    const { speeches, topic } = req.body;

    // Validate input
    if (!speeches || !Array.isArray(speeches) || speeches.length === 0) {
      return res.status(400).json({ 
        success: false, 
        error: "Speeches must be a non-empty array",
        received: { speeches: speeches?.length || 'null' }
      });
    }

    if (!topic) {
      return res.status(400).json({ success: false, error: "Topic is required" });
    }

    // Since we're using NVIDIA LLM exclusively now, return success
    // The analyzeWithOpenAI function (which uses NVIDIA) is the primary feedback engine
    res.json({ 
      success: true, 
      analysis: null, // Frontend will use OpenAI analysis (which is actually NVIDIA LLM)
      note: "Using primary LLM feedback analysis" 
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// Helper function to generate intelligent fallback responses based on debate context
const generateIntelligentFallback = (userArgument, topic, debateContext) => {
  const debateHistoryCount = debateContext ? debateContext.length : 0;
  
  // Analyze user argument for key topics
  const argWords = userArgument.toLowerCase().split(/\s+/);
  
  // Strategy-based responses that actually reference counterpoints
  const strategicResponses = {
    early: [
      "I understand your perspective on this, but data shows that actually works against your argument.",
      "That's a common misconception. Let me explain why the evidence contradicts that point.",
      "I see the logic, but you haven't addressed the core issue: the practical implementation challenges.",
      "Your argument overlooks a critical detail that changes the entire outcome.",
      "While that sounds logical, real-world examples demonstrate the opposite effect."
    ],
    middle: [
      "You make a valid attempt, but my earlier point about [the fundamental challenge] directly contradicts that.",
      "Building on what I said before, this actually strengthens my position even further.",
      "I appreciate the effort, but that doesn't address my core concern about feasibility.",
      "That argument fails because it ignores the systemic issues I raised.",
      "You're making an assumption that I've already proven false in earlier statements."
    ],
    late: [
      "After all the evidence we've discussed, your position still doesn't hold up to scrutiny.",
      "Your argument is contradicted by the multiple points I've already established.",
      "This doesn't change the fundamental weakness in your position that I've highlighted.",
      "You're repeating an argument I've already dismantled with concrete evidence.",
      "Your conclusion ignores all the counterpoints I've systematically presented."
    ]
  };

  // Pick response based on debate stage
  let responses;
  if (debateHistoryCount < 3) {
    responses = strategicResponses.early;
  } else if (debateHistoryCount < 7) {
    responses = strategicResponses.middle;
  } else {
    responses = strategicResponses.late;
  }

  return responses[Math.floor(Math.random() * responses.length)];
};

// Get AI Response to user's argument - WITH STREAMING & TOPIC ENFORCEMENT
exports.getAIResponse = async (req, res) => {
  try {
    const { userArgument, topic, debateContext } = req.body;

    console.log('[getAIResponse] Received:', { userArgument, topic, contextLength: debateContext?.length || 0 });

    if (!userArgument || !topic) {
      return res.status(400).json({ 
        success: false, 
        error: "userArgument and topic are required" 
      });
    }

    // Check if user is going off-topic
    const topicKeywords = topic.toLowerCase().split(/\s+/).filter(w => w.length > 3);
    const userWords = userArgument.toLowerCase().split(/\s+/);
    const topicMatches = topicKeywords.filter(kw => userWords.some(uw => uw.includes(kw))).length;
    const topicRelevance = topicKeywords.length > 0 ? topicMatches / topicKeywords.length : 0;

    // If user is off-topic (less than 30% match), redirect them
    if (topicRelevance < 0.3 && debateContext && debateContext.length > 2) {
      console.log('[getAIResponse] User going off-topic. Relevance:', topicRelevance);
      const redirectResponse = `Let's stay focused on our topic: "${topic}". I appreciate your point, but can you connect it back to the main question?`;
      
      return res.json({
        success: true,
        response: redirectResponse,
        points: 0,
        qualityScore: 0,
        scoreBreakdown: { 'Off-topic': 'Redirecting to main topic' },
        engine: 'topic-enforcement',
        isOffTopic: true
      });
    }

    const nvidiaApiKey = process.env.NVIDIA_API_KEY;
    const nvidiaApiUrl = process.env.NVIDIA_API_URL || 'https://integrate.api.nvidia.com/v1';
    const nvidiaModel = process.env.NVIDIA_MODEL || 'nvidia/nemotron-3-super-120b-a12b';

    console.log('[getAIResponse] ===== DEBUG INFO =====');
    console.log('[getAIResponse] NVIDIA_API_KEY set:', nvidiaApiKey ? 'YES' : 'NO');
    console.log('[getAIResponse] NVIDIA_API_URL:', nvidiaApiUrl);
    console.log('[getAIResponse] NVIDIA_MODEL:', nvidiaModel);
    console.log('[getAIResponse] =====================');

    // Prepare debate history for context
    const conversationHistory = (debateContext && Array.isArray(debateContext))
      ? debateContext
          .filter(item => item && item.text)
          .map((item, idx) => `${item.speaker === "user" ? 'You' : 'Opponent'}: ${item.text}`)
          .join("\n\n")
      : "This is the opening of the debate.";

    const prompt = `You are a debate opponent in a simple, friendly debate.

DEBATE TOPIC: "${topic}"

DEBATE HISTORY:
${conversationHistory}

THE USER JUST SAID: "${userArgument}"

Your task: Give a SHORT, friendly counter-argument (2-3 sentences MAX).

RULES:
1. Keep it SHORT and SIMPLE - anyone can understand
2. Use everyday words, not fancy language
3. Acknowledge their point, then give your opposite view
4. Add ONE simple reason why your view is better
5. Sound natural, like talking to a friend
6. Stay on the topic: "${topic}"

EXAMPLE:
User: "Remote work helps people focus more."
Response: "I see why you'd think that, but I disagree. Working from home has lots of distractions like family, pets, and chores. Plus, teams work better together in one place."

Now give YOUR response (2-3 sentences only, no more):`;

    let aiResponse = null;
    let engineUsed = 'nvidia';
    
    console.log('[getAIResponse] Calling NVIDIA for response');
    aiResponse = await callNvidiaAPI(prompt, nvidiaApiKey, nvidiaApiUrl, nvidiaModel);
    console.log('[getAIResponse] ✓ NVIDIA response received:', aiResponse.substring(0, 100));

    // Calculate points based on argument QUALITY
    const scoreResult = calculateQualityBasedPoints(userArgument);
    const points = scoreResult.points;
    
    console.log('[getAIResponse] ✓ Response ready and sent');

    res.json({
      success: true,
      response: aiResponse,
      points: points,
      qualityScore: scoreResult.qualityScore,
      scoreBreakdown: scoreResult.analysis.breakdown,
      engine: engineUsed,
      turnNumber: debateContext ? debateContext.length : 0
    });

  } catch (error) {
    console.error('[getAIResponse] Error:', error);
    
    // Simple emergency response
    const emergencyResponse = `I see your point, but I think differently about "${topic}". Let me explain why my view makes more sense.`;
    
    res.json({
      success: true,
      response: emergencyResponse,
      points: 5,
      engine: 'emergency-fallback'
    });
  }
};

// =====================================================
// VALIDATE DEBATE TOPIC using AI (checks if topic is valid for debate)
// =====================================================
exports.validateTopic = async (req, res) => {
  try {
    const { topic } = req.body;

    // Basic validation
    if (!topic || typeof topic !== 'string') {
      return res.status(400).json({ 
        success: false, 
        error: "Topic must be a non-empty string",
        isValid: false
      });
    }

    const trimmedTopic = topic.trim();

    // Check minimum length
    if (trimmedTopic.length < 5) {
      return res.status(400).json({ 
        success: true, 
        isValid: false,
        reason: "Topic is too short. Please provide at least 5 characters.",
        suggestion: "Try: 'Is artificial intelligence beneficial to society?'"
      });
    }

    // Check maximum length
    if (trimmedTopic.length > 200) {
      return res.status(400).json({ 
        success: true, 
        isValid: false,
        reason: "Topic is too long. Please keep it under 200 characters."
      });
    }

    // Use NVIDIA LLM to validate if it's a good debate topic
    const nvidiaApiKey = process.env.NVIDIA_API_KEY;
    const nvidiaApiUrl = process.env.NVIDIA_API_URL || 'https://integrate.api.nvidia.com/v1';
    const nvidiaModel = process.env.NVIDIA_MODEL || 'nvidia/nemotron-3-super-120b-a12b';

    if (!nvidiaApiKey) {
      console.warn('[validateTopic] ⚠️ NVIDIA API key not configured, using basic validation');
      
      // Simple local validation if no API key
      const invalidPatterns = [
        /^\d+$/,  // Only numbers
        /^[!@#$%^&*()]+$/,  // Only special characters
        /what is your name/i,
        /who are you/i,
        /help me/i,
        /code/i
      ];

      const isInvalid = invalidPatterns.some(pattern => pattern.test(trimmedTopic));
      
      if (isInvalid) {
        return res.json({ 
          success: true, 
          isValid: false,
          reason: "This topic is not suitable for debate. Choose a topic with multiple perspectives.",
          suggestion: "Try topics like: 'Should AI be regulated?', 'Is remote work better?', 'Should we limit social media?'"
        });
      }

      // Allow it if local validation passes
      return res.json({ 
        success: true, 
        isValid: true,
        message: "✅ Topic is valid! You can start debating now."
      });
    }

    // Use NVIDIA to validate topic quality
    const validationPrompt = `You are a debate topic validator. Evaluate if this topic is suitable for a debate between humans and AI.

Topic: "${trimmedTopic}"

A VALID debate topic should:
1. Have multiple valid perspectives or viewpoints
2. Be about a significant issue (not trivial)
3. Be specific enough to discuss (not too vague)
4. Not be hate speech, offensive, or harmful
5. Be appropriate for respectful discussion

Respond with ONLY valid JSON (no markdown):
{
  "isValid": true/false,
  "score": 1-100,
  "reason": "brief explanation",
  "suggestion": "if invalid, suggest a better topic"
}`;

    try {
      const endpoint = `${nvidiaApiUrl.replace(/\/chat\/completions$/, '')}/chat/completions`;
      
      const nvidiaResponse = await axios.post(
        endpoint,
        {
          model: nvidiaModel,
          messages: [
            {
              role: 'system',
              content: 'You are a debate topic validator. Respond with only valid JSON.'
            },
            {
              role: 'user',
              content: validationPrompt
            }
          ],
          max_tokens: 300,
          temperature: 0.3,
          top_p: 0.9
        },
        {
          headers: {
            'Authorization': `Bearer ${nvidiaApiKey}`,
            'Content-Type': 'application/json'
          },
          timeout: 0  // No timeout - wait as long as NVIDIA needs
        }
      );

      const responseText = nvidiaResponse.data?.choices?.[0]?.message?.content;
      console.log('[validateTopic] ✅ NVIDIA Response received');
      console.log('[validateTopic] Response:', responseText);

      if (!responseText) {
        throw new Error('No validation response from NVIDIA');
      }

      // Parse JSON response
      let validation = JSON.parse(responseText);
      
      console.log('[validateTopic] Validation result:', {
        isValid: validation.isValid,
        score: validation.score,
        reason: validation.reason
      });

      if (validation.isValid && validation.score >= 60) {
        return res.json({ 
          success: true, 
          isValid: true,
          score: validation.score,
          message: "✅ Topic is valid! You can start debating now.",
          source: 'NVIDIA_VALIDATION'
        });
      } else {
        return res.json({ 
          success: true, 
          isValid: false,
          score: validation.score || 0,
          reason: validation.reason || "This topic is not suitable for debate.",
          suggestion: validation.suggestion || "Try topics like: 'Should AI be regulated?', 'Is remote work better?'",
          source: 'NVIDIA_VALIDATION'
        });
      }

    } catch (nvidiaError) {
      console.error('[validateTopic] ❌ NVIDIA FAILED:', nvidiaError.message);
      
      // Fallback: Use local validation if NVIDIA fails
      console.warn('[validateTopic] ⚠️ Using fallback local validation');
      
      const invalidPatterns = [
        /^\d+$/,
        /^[!@#$%^&*()]+$/,
        /what is your name/i,
        /who are you/i,
        /help me/i,
        /^(help|hack|crack|bypass)/i
      ];

      const isInvalid = invalidPatterns.some(pattern => pattern.test(trimmedTopic));
      
      if (isInvalid) {
        return res.json({ 
          success: true, 
          isValid: false,
          reason: "This topic is not suitable for debate. Choose a topic with multiple perspectives.",
          suggestion: "Try topics like: 'Should AI be regulated?', 'Is remote work better?', 'Should we limit social media?'",
          source: 'LOCAL_FALLBACK'
        });
      }

      return res.json({ 
        success: true, 
        isValid: true,
        message: "✅ Topic is valid! You can start debating now.",
        source: 'LOCAL_FALLBACK'
      });
    }

  } catch (error) {
    console.error('[validateTopic] Error:', error.message);
    res.status(500).json({ 
      success: false, 
      error: error.message,
      isValid: false
    });
  }
};

// NEW: Analyze multi-participant debate with NVIDIA LLM
exports.analyzeMultiParticipant = async (req, res) => {
  try {
    const { speeches, topic, participants } = req.body;

    // Validate input
    if (!speeches || !Array.isArray(speeches) || speeches.length === 0) {
      return res.status(400).json({ 
        success: false, 
        error: "Speeches must be a non-empty array",
        received: { speeches: speeches?.length || 'null' }
      });
    }

    if (!topic) {
      return res.status(400).json({ success: false, error: "Topic is required" });
    }

    if (!participants || !Array.isArray(participants) || participants.length === 0) {
      return res.status(400).json({ 
        success: false, 
        error: "Participants array is required"
      });
    }

    const nvidiaApiKey = process.env.NVIDIA_API_KEY;
    const nvidiaApiUrl = process.env.NVIDIA_API_URL || 'https://integrate.api.nvidia.com/v1';
    const nvidiaModel = process.env.NVIDIA_MODEL || 'nvidia/nemotron-3-super-120b-a12b';

    // Build unified transcript with all speakers
    const unifiedTranscript = speeches
      .map((s, idx) => {
        const speaker = s.playerName || `Participant ${idx + 1}`;
        return `${speaker}: "${s.text}"`;
      })
      .join("\n\n");

    // Get unique speakers and their stats
    const participantStats = {};
    participants.forEach(p => {
      participantStats[p.userId || p.playerName] = {
        playerName: p.playerName,
        totalSpeeches: 0,
        totalPoints: 0,
        totalWords: 0
      };
    });

    // Calculate stats
    speeches.forEach(s => {
      const key = s.userId || s.playerName;
      if (participantStats[key]) {
        participantStats[key].totalSpeeches += 1;
        participantStats[key].totalPoints += s.points || 0;
        participantStats[key].totalWords += (s.text ? s.text.split(' ').length : 0);
      }
    });

    const feedbackPrompt = `You are a friendly debate coach analyzing a multi-participant debate. Your job is to give each participant personalized feedback comparing their performance.

DEBATE TOPIC: "${topic}"

DEBATE TRANSCRIPT (all participants):
${unifiedTranscript}

PARTICIPANTS AND THEIR STATS:
${Object.values(participantStats).map(p => 
  `- ${p.playerName}: ${p.totalSpeeches} speeches, ${p.totalPoints} points, ${p.totalWords} words`
).join('\n')}

Analyze EACH participant's performance and provide:
1. Individual score (1-10) based on clarity, logic, engagement, and argument quality
2. Key strengths specific to what they said
3. One area for improvement
4. Compare them: Who made the best argument? Who was most engaged? Who needs more examples?

Return ONLY valid JSON, no markdown:

{
  "topic": "${topic}",
  "participantFeedback": [
    {
      "playerName": "name",
      "overallScore": 8,
      "summary": "Brief assessment of their performance",
      "strength": "What they did well with specific example",
      "improvement": "One specific thing to work on",
      "advice": "One tip for next time"
    }
  ],
  "debateHighlights": {
    "bestArgument": "Quote or description of the best overall argument",
    "bestResponseToPoint": "Description of best counter-argument",
    "mostEngaged": "Name of most active participant",
    "keyInsight": "What was the main debate about - what sides won?"
  },
  "topicInsights": "2-3 sentence summary of the debate and what both sides got right"
}`;

    try {
      console.log('[analyzeMultiParticipant] 📊 Analyzing multi-participant debate with', participants.length, 'participants');
      
      const endpoint = `${nvidiaApiUrl.replace(/\/chat\/completions$/, '')}/chat/completions`;
      
      const nvidiaResponse = await axios.post(
        endpoint,
        {
          model: nvidiaModel,
          messages: [
            {
              role: 'system',
              content: `You are an expert debate coach analyzing multi-participant debates. You evaluate each participant fairly and provide constructive feedback. Keep analysis concise and actionable.`
            },
            {
              role: 'user',
              content: feedbackPrompt
            }
          ],
          max_tokens: 2000,
          temperature: 0.7,
          top_p: 0.95
        },
        {
          headers: {
            'Authorization': `Bearer ${nvidiaApiKey}`,
            'Content-Type': 'application/json'
          },
          timeout: 30000
        }
      );

      const analysisText = nvidiaResponse.data?.choices?.[0]?.message?.content;
      console.log('[analyzeMultiParticipant] ✅ NVIDIA Response received');

      if (!analysisText) {
        throw new Error('No analysis text from NVIDIA');
      }

      // Parse JSON response
      let analysis = JSON.parse(analysisText);
      console.log('[analyzeMultiParticipant] ✅ JSON parsed. Analyzing', analysis.participantFeedback?.length, 'participants');
      
      return res.json({ 
        success: true, 
        analysis,
        participantCount: participants.length,
        speechCount: speeches.length,
        source: 'NVIDIA_LLM_MULTI_PARTICIPANT',
        timestamp: new Date().toISOString()
      });

    } catch (llmError) {
      console.error('[analyzeMultiParticipant] ❌ LLM FAILED:', llmError.message);
      
      // Fallback: Return individual analysis for each participant
      console.warn('[analyzeMultiParticipant] ⚠️ FALLING BACK TO TEMPLATE FEEDBACK');
      
      const fallbackAnalysis = {
        topic,
        participantFeedback: participants.map(p => {
          const stats = participantStats[p.userId || p.playerName];
          const baseScore = Math.min(10, 5 + (stats.totalSpeeches || 0));
          
          return {
            playerName: p.playerName,
            overallScore: baseScore,
            summary: `Great participation with ${stats.totalSpeeches} speeches and ${stats.totalPoints} points!`,
            strength: "You participated actively and shared your ideas clearly",
            improvement: "Consider using more specific examples to support your points",
            advice: "Next debate, prepare 1-2 concrete examples before you start"
          };
        }),
        debateHighlights: {
          bestArgument: "This debate had several interesting perspectives on the topic",
          bestResponseToPoint: "The participants engaged well with each other's points",
          mostEngaged: participants.length > 0 ? participants[0].playerName : "All participants",
          keyInsight: "Great debate showing multiple valid perspectives on the topic"
        },
        topicInsights: "This was a productive debate where participants explored different angles of the topic."
      };
      
      return res.json({ 
        success: true, 
        analysis: fallbackAnalysis,
        participantCount: participants.length,
        speechCount: speeches.length,
        source: 'FALLBACK_TEMPLATE',
        warning: '⚠️ Using template feedback - LLM unavailable',
        timestamp: new Date().toISOString()
      });
    }

  } catch (error) {
    console.error('[analyzeMultiParticipant] Error:', error.message);
    res.status(500).json({ 
      success: false, 
      error: error.message,
      source: 'ERROR'
    });
  }
};
