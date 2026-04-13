const axios = require('axios');
const { Debate, debates, rooms } = require('../models/index');
const { analyzeDebateArgument } = require('../utils/debateArgumentAnalysis');
const { calculateQualityBasedPoints } = require('../utils/advancedScoringSystem');

const STOPWORDS = new Set([
  'the', 'is', 'are', 'was', 'were', 'and', 'for', 'with', 'that', 'this', 'from', 'into', 'your', 'you',
  'about', 'have', 'has', 'had', 'will', 'would', 'could', 'should', 'what', 'when', 'where', 'which',
  'their', 'there', 'than', 'then', 'them', 'they', 'been', 'being', 'but', 'because', 'while', 'also',
  'very', 'more', 'most', 'only', 'just', 'over', 'under', 'after', 'before', 'against', 'between',
  'through', 'during', 'such', 'each', 'any', 'all', 'not'
]);

const extractKeywords = (text, minLength = 4) => {
  if (!text) return [];
  return String(text)
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .map((w) => w.trim())
    .filter((w) => w.length >= minLength && !STOPWORDS.has(w));
};

const calculateKeywordRelevance = (text, keywords = []) => {
  if (!text || !keywords.length) return 0;
  const lowerText = String(text).toLowerCase();
  const uniqueKeywords = [...new Set(keywords)];
  const matched = uniqueKeywords.filter((kw) => lowerText.includes(kw)).length;
  return matched / uniqueKeywords.length;
};

const buildTopicLockedFallbackResponse = (userArgument, topic, argumentInsights) => {
  const claimSnippet = String(userArgument || '').trim().slice(0, 140) || `your position on ${topic}`;
  const strongestClaim = argumentInsights?.claims?.[0] || claimSnippet;
  const strategyHint = argumentInsights?.strategy?.techniques?.[0] || 'causal weakness';

  return `But "${strongestClaim}" still misses the key trade-off in ${topic}, so the point is not fully convincing. If it is really strong, explain why it still holds when the practical consequences and counter-evidence are pushed hard.`;
};

// =====================================================
// NVIDIA API Integration Function (works with Nemotron models)
// =====================================================
const callNvidiaAPI = async (prompt, apiKey, apiUrl, model, options = {}) => {
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
    
    const systemPrompt = options.systemPrompt || 'You are the second speaker in a simple back-and-forth debate. Reply like Person 2 in a sample classroom debate: short, natural, direct, and focused on the user\'s last point. Keep it conversational, do not be generic, and do not use meta-talk. Start the response directly.';

    const requestBody = {
      model: model,
      messages: [
        { 
          role: 'system', 
          content: systemPrompt
        },
        { 
          role: 'user', 
          content: prompt
        }
      ],
      max_tokens: options.maxTokens || 128,
      temperature: options.temperature ?? 0.9,
      top_p: options.topP ?? 1.0,
      presence_penalty: options.presencePenalty ?? 0.6,
      frequency_penalty: options.frequencyPenalty ?? 0.6,
      stream: false 
    };
    
    console.log('[NVIDIA] Sending request with content:', requestBody.messages[0].content.substring(0, 50) + "...");
    
    const response = await axios.post(
      endpoint,
      requestBody,
      {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        timeout: 120000 
      }
    );

    console.log('[NVIDIA] ✅ Response status:', response.status);
    console.log('[NVIDIA] ✅ Raw response content:', response.data?.choices?.[0]?.message?.content);
    
    const message = response.data?.choices?.[0]?.message;
    
    if (message) {
      // Get content or reasoning content
      let text = (message.content || message.reasoning_content || message.text || '').trim();
      
      console.log('[NVIDIA] Raw text from API:', text);

      // If none of those, try reasoning
      if (!text && message.reasoning) text = message.reasoning.trim();

      // CLEANING: Extract only the core response from the LLM output
      // Handle the common pattern of <thought> blocks or meta-text
      let coreText = text;
      
      // Remove any <thought> blocks if the model uses them
      coreText = coreText.replace(/<thought>[\s\S]*?<\/thought>/gi, "").trim();

      // Split by newlines and only keep parts that don't look like planning
      const parts = coreText.split(/\n+/);
      
      // Filter out meta-text (rules, counts, "sentence 1:", instructions)
      const filteredParts = parts.filter(p => {
          const lower = p.toLowerCase();
          return !lower.includes("sentence") && 
                 !lower.includes("word") && 
                 !lower.includes("punctuation") &&
                 !lower.includes("trailing spaces") &&
                 !lower.includes("i will follow") &&
                 !lower.includes("greetings") &&
                 !lower.includes("must not") &&
                 !lower.includes("do not") &&
                 !lower.includes("start with") &&
                 !lower.includes("we need to") &&
                 !lower.includes("we must") &&
                 !lower.includes("let's craft") &&
                 !lower.includes("the user says") &&
                 p.trim().length > 5;
      });

      // Join back or take the last significant part
      let cleaned = filteredParts.length > 0 ? filteredParts.join(" ").trim() : coreText.trim();

      // Final scrubbing of meta-text labels
      let aiResponse = cleaned
        .replace(/^(AI:|Response:|Direct response:|Answer:|Counter-Argument:|Argument:)/i, "")
        .replace(/Let's craft:.*/gi, "") 
        .replace(/\[.*?\]/g, "") 
        .trim();

      // Ensure no garbage meta-headers remain at the start
      if (aiResponse.match(/^(sentence\s*\d+:|word\s*count:)/i)) {
          aiResponse = aiResponse.split(/[.!?]+/)[0].trim() + ".";
      }

      // If the output is just a single block of text (typical), or has multiple sentences
      // we ONLY want to extract a quote if it truly looks like the model is "suggesting" a quote as part of a longer meta-talk response.
      if (aiResponse.includes('"')) {
        const matches = [...aiResponse.matchAll(/"([^"]+)"/g)];
        if (matches.length > 0) {
          // Take the LONGEST quoted segment as it's likely the actual argument
          const possibleArgument = matches.reduce((prev, current) => 
            (prev[1].length > current[1].length) ? prev : current
          )[1];
          
          // CRITICAL: If the AI output is very long (over 100 chars) AND contains a quote,
          // it's highly likely the argument is just what's inside the quote.
          if (aiResponse.length > 100 && possibleArgument.length > 15 && !possibleArgument.toLowerCase().includes("user says")) {
            aiResponse = possibleArgument;
          }
        }
      }

      // If the model gave meta-talk but NO quotes, try to find the last sentence.
      if (aiResponse.length > 150 && !aiResponse.includes('"')) {
          const sentences = aiResponse.split(/[.!?]+/);
          // Look for sentences that don't have meta keywords
          const goodSentences = sentences.filter(s => 
              s.length > 20 && 
              !s.toLowerCase().includes("we need to") && 
              !s.toLowerCase().includes("let's") &&
              !s.toLowerCase().includes("producing a")
          );
          if (goodSentences.length > 0) {
              aiResponse = goodSentences[goodSentences.length - 1].trim() + ".";
          }
      }

      // Final cleanup of common prefixes models add even when told not to
      aiResponse = aiResponse
        .replace(/^(Certainly!|Okay,|Here is a|My response is:|Counter-Argument:|Argument:)/gi, "")
        .replace(/^(Make it professional:|Firm counter-argument:)/gi, "")
        .replace(/^Let's craft: /gi, "")
        .trim();

      // Final strip of all quotes from beginning and end
      aiResponse = aiResponse.replace(/^["']+(.*?)["']+$/g, '$1').trim();

      // Ensure it ends correctly
      if (aiResponse.length > 5 && !aiResponse.match(/[.!?]$/)) aiResponse += ".";

      // Safety check: ensure no garbage remains
      if (aiResponse.includes("Words:") || aiResponse.includes("Total =")) {
          // Harsh fallback if cleaning fails - try to find a sentence that doesn't look like planning
          const sentences = aiResponse.split(/[.!?]+/);
          aiResponse = sentences.find(s => !s.toLowerCase().includes('word') && s.trim().length > 10) || "I disagree with your point.";
      }

      console.log('[NVIDIA] ✅ Response received successfully');
      console.log('[NVIDIA] ===== NVIDIA API CALL SUCCESS =====');
      return aiResponse;
    }
    
    throw new Error('Could not parse NVIDIA response');
  } catch (error) {
    console.error('[NVIDIA] ❌ ===== NVIDIA API ERROR =====');
    console.error('[NVIDIA] Error message:', error.message);
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

    if (!nvidiaApiKey) {
      throw new Error('NVIDIA API key not configured');
    }

    // Filter user speeches (speaker !== "ai")
    const userSpeeches = speeches.filter(s => s.speaker !== 'ai').map(s => s.text).join('\n\n');
    
    // Format all speeches with alternating speaker labels for context
    const speechText = speeches
      .map((s, idx) => {
        let speaker = s.speaker === 'ai' ? '🤖 AI' : '👤 USER';
        return `${speaker}: ${s.text}`;
      })
      .join("\n");

    // ⚡ OPTIMIZED: Create a cache key for this debate's speeches
    const crypto = require('crypto');
    const speechHash = crypto.createHash('md5').update(JSON.stringify(speeches) + topic).digest('hex').substring(0, 8);
    const cacheKey = `feedback_${speechHash}`;
    
    // Check if we have cached feedback
    const feedbackCache = global.feedbackCache || {};
    if (feedbackCache[cacheKey] && Date.now() - feedbackCache[cacheKey].timestamp < 3600000) {
      console.log('[analyzeWithOpenAI] ✅ CACHED RESULT (within 1 hour)');
      return res.json({ 
        success: true, 
        analysis: feedbackCache[cacheKey].data,
        source: 'CACHED_NVIDIA_LLM',
        timestamp: new Date().toISOString()
      });
    }
    if (!global.feedbackCache) global.feedbackCache = {};

    // ⚡ OPTIMIZED: Use shorter, faster prompt for quicker LLM response
    const feedbackPrompt = `Topic: ${topic}\nDebate (${speeches.length} turns):\n${speechText}\n\nReturn JSON: {"overall_score": 1-10, "summary": "1 sentence", "strengths": [2 items], "weaknesses": [2 items], "recommendations": [2 items]}`;

    // Construct proper endpoint URL
    const endpoint = `${nvidiaApiUrl.replace(/\/chat\/completions$/, '')}/chat/completions`;

    console.log('[analyzeWithOpenAI] ⚡ SPEED OPTIMIZED START (15s timeout)');
    
    const response = await axios.post(
      endpoint,
      {
        model: nvidiaModel,
        messages: [
          { role: 'system', content: 'Return ONLY valid JSON. Concise analysis.' },
          { role: 'user', content: feedbackPrompt }
        ],
        max_tokens: 256,  // ⚡ Reduced from 1024 for faster generation
        temperature: 0.05,  // ⚡ Lower temp for faster deterministic response
        stream: false
      },
      {
        headers: {
          'Authorization': `Bearer ${nvidiaApiKey}`,
          'Content-Type': 'application/json'
        },
        timeout: 15000  // ⚡ Reduced from 60s to 15s for aggressive timeout
      }
    );

    const analysisText = response.data?.choices?.[0]?.message?.content;
    
    if (!analysisText) {
      throw new Error('No analysis text from NVIDIA');
    }

    // Clean JSON if needed (remove markdown blocks)
    const cleanedJson = analysisText.replace(/```json|```/g, '').trim();
    let analysis = JSON.parse(cleanedJson);
    
    // ⚡ Cache the result for future identical debates
    global.feedbackCache[cacheKey] = {
      data: analysis,
      timestamp: Date.now()
    };
    
    res.json({ 
      success: true, 
      analysis,
      source: 'NVIDIA_LLM',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('[analyzeWithOpenAI] ❌ FAST ANALYSIS FAILED:', error.message);
    
    // IMMEDIATE FALLBACK (within 100ms) - No long waiting
    const fallbackAnalysis = {
      overall_score: 7,
      summary: "Great effort in the debate! Your points were clear.",
      strengths: ["Clear articulation", "Maintained focus on topic"],
      weaknesses: ["Could use more data", "Counter-arguments need more depth"],
      key_points: ["Arguments based on general logic"],
      recommendations: ["Try adding statistics", "Focus on opponent weaknesses"]
    };

    res.json({ 
      success: true, 
      analysis: fallbackAnalysis,
      source: 'FALLBACK_FAST',
      warning: "Real-time AI analysis busy, providing immediate baseline feedback."
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
    const { userArgument, topic, debateContext, speechMeta = {} } = req.body;

    console.log('[getAIResponse] Received:', { userArgument, topic, contextLength: debateContext?.length || 0 });

    if (!userArgument || !topic) {
      return res.status(400).json({ 
        success: false, 
        error: "userArgument and topic are required" 
      });
    }

    // Check if user is going off-topic
    const topicKeywords = extractKeywords(topic, 4);
    const userWords = userArgument.toLowerCase().split(/\s+/);
    const topicMatches = topicKeywords.filter(kw => userWords.some(uw => uw.includes(kw))).length;
    const topicRelevance = topicKeywords.length > 0 ? topicMatches / topicKeywords.length : 0;

    // If user is off-topic (less than 30% match), redirect them firmly
    if (topicRelevance < 0.25 && debateContext && debateContext.length > 2) {
      console.log('[getAIResponse] User going off-topic. Relevance:', topicRelevance);
      const redirectResponse = `We're debating: "${topic}". Your argument is moving away from this topic. Let's refocus: can you explain how your point connects back to the core question about ${topic}?`;
      
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

    const normalizedContext = (debateContext && Array.isArray(debateContext))
      ? debateContext.filter(item => item && item.text)
      : [];

    // Prepare debate history for context
    const conversationHistory = normalizedContext.length
      ? normalizedContext
          .slice(-6)
          .map((item) => {
            const normalizedSpeaker = String(item.speaker || '').toLowerCase();
            const speakerLabel = normalizedSpeaker === 'ai' ? 'AI' : 'User';
            return `${speakerLabel}: ${item.text}`;
          })
          .join("\n")
      : "Start of debate.";

    const argumentInsights = analyzeDebateArgument(userArgument, topic, normalizedContext);
    const turnNumber = normalizedContext.length + 1;
    const wordCount = String(userArgument).split(/\s+/).filter(Boolean).length;
    const responseMode = speechMeta?.responseMode || 'direct-rebuttal';
    const silenceDurationSec = Number(speechMeta?.silenceDurationSec) || null;
    const speechDuration = Number(speechMeta?.speechDuration) || null;
    const transcriptSource = speechMeta?.transcriptSource || 'final';
    const speechPace = speechDuration && speechDuration > 0
      ? Math.round((wordCount / speechDuration) * 60)
      : null;
    const speechPaceBand = !speechPace
      ? 'unknown'
      : speechPace > 170
        ? 'fast'
        : speechPace < 95
          ? 'deliberate'
          : 'balanced';

            const responseStyleInstruction = responseMode === 'auto-counter'
          ? `This is a silence counterattack turn: the user has stayed silent for about ${silenceDurationSec || 'several'} seconds.
        8. Reply like the next line in a natural debate sample: short, direct, and forceful.
        9. Keep tone assertive but debate-safe (no abuse, no slurs).`
          : `8. Reply like the next line in a sample back-and-forth debate and stay tightly tied to the latest user claim.`;

    const prompt = `You are in a real-time live debate round.

Debate Topic: "${topic}"
Turn Number: ${turnNumber}
Current User Argument: "${userArgument}"

Recent Transcript:
${conversationHistory}

User Speech Signals:
- Transcript source: ${transcriptSource}
- User words: ${wordCount}
- Approx speech duration (sec): ${speechDuration || 'unknown'}
- Estimated pace (wpm): ${speechPace || 'unknown'} (${speechPaceBand})

Argument Analysis Signals:
- Claims: ${argumentInsights.claims?.slice(0, 3).join(' | ') || 'none'}
- Strength tags: ${(argumentInsights.strength?.analysis || []).join(', ') || 'none'}
- Counter strategy: ${argumentInsights.strategy?.techniques?.slice(0, 3).join(', ') || 'challenge assumptions'}

Response requirements:
1. Write a natural rebuttal like a real debate opponent, not a chatbot.
2. Use only 1-2 sentences, around 25-45 words.
3. Directly attack one specific claim from the user argument.
4. Mention the topic phrase "${topic}" at least once in the response if it fits naturally.
5. Sound like the second person in a simple debate sample, not a long essay.
6. Add one concrete reason/example or causal explanation.
7. Never agree with the user and never use meta-talk.
8. Match the user's language style (English/Hinglish/Hindi mix) if detectable.
${responseStyleInstruction}

Return only the rebuttal text.`;

    let aiResponse = "";
    let engineUsed = 'nvidia';
    
    try {
      console.log(`[getAIResponse] Calling NVIDIA for turn ${debateContext ? debateContext.length : 1}`);
      
      const response = await callNvidiaAPI(prompt, nvidiaApiKey, nvidiaApiUrl, nvidiaModel, {
        systemPrompt: 'You are the second speaker in a back-and-forth sample debate. Be concise, natural, and directly disagree with the user\'s last point. Sound like a real debate partner, not a polished essay writer. Never output planning notes, bullet points, JSON, or role labels.',
        maxTokens: 120,
        temperature: 0.6,
        topP: 0.95,
        presencePenalty: 0.4,
        frequencyPenalty: 0.35
      });
      
      if (response && response.length > 5) {
        aiResponse = response.trim();
        // Clean any residual meta-text
        aiResponse = aiResponse.replace(/^(AI:|Response:|Counter-Argument:|Argument:)/i, "").trim();
        aiResponse = aiResponse.replace(/^["']+(.*?)["']+$/g, '$1').trim();
        aiResponse = aiResponse.replace(/\s{2,}/g, ' ').trim();

        const aiWordCount = aiResponse.split(/\s+/).filter(Boolean).length;
        const responseTopicRelevance = calculateKeywordRelevance(aiResponse, topicKeywords);
        const claimKeywords = extractKeywords(userArgument, 5).slice(0, 6);
        const claimRelevance = calculateKeywordRelevance(aiResponse, claimKeywords);

        // Hard guardrail: if response is too short or drifts from topic/claim, use deterministic topic-locked fallback.
        if (aiWordCount < 20 || aiWordCount > 60 || responseTopicRelevance < 0.2 || claimRelevance < 0.15) {
          console.warn('[getAIResponse] Response quality guardrail triggered:', {
            aiWordCount,
            responseTopicRelevance,
            claimRelevance
          });
          aiResponse = buildTopicLockedFallbackResponse(userArgument, topic, argumentInsights);
          engineUsed = 'topic-locked-fallback';
        }
      } else {
        throw new Error("Empty response from LLM");
      }
      
      console.log('[getAIResponse] ✓ Final LLM Response:', aiResponse);
    } catch (apiError) {
      console.error('[getAIResponse] LLM Error:', apiError.message);
      // RE-THROW to trigger the main catch block for emergency fallback
      throw apiError;
    }

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
    
    // Simple emergency response - ensure "topic" is available from the request if possible
    const currentTopic = req.body.topic || "this topic";
    const fallbackUserClaim = String(req.body.userArgument || '').trim();
    const emergencyInsights = analyzeDebateArgument(fallbackUserClaim, currentTopic, Array.isArray(req.body.debateContext) ? req.body.debateContext : []);
    const emergencyResponse = buildTopicLockedFallbackResponse(fallbackUserClaim, currentTopic, emergencyInsights);
    
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
          timeout: 60000  // 60 seconds - NVIDIA can take time
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
          timeout: 60000  // 60 seconds - NVIDIA can take time for multi-participant analysis
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
