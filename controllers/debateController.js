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

const cleanLlmText = (text) => String(text || '')
  .replace(/```(?:json)?/gi, '')
  .replace(/```/g, '')
  .replace(/\r/g, '')
  .trim();

const extractSectionedAnalysis = (text) => {
  const cleaned = cleanLlmText(text);
  const sections = {
    overall_score: 0,
    summary: cleaned,
    strengths: [],
    weaknesses: [],
    recommendations: []
  };

  const readSection = (label, nextLabels = []) => {
    const labelRegex = new RegExp(`(?:^|\n)\s*${label}\s*:\s*`, 'i');
    const labelMatch = cleaned.match(labelRegex);
    if (!labelMatch || labelMatch.index === undefined) return '';

    const startIndex = labelMatch.index + labelMatch[0].length;
    const remainder = cleaned.slice(startIndex);

    let endIndex = remainder.length;
    nextLabels.forEach((nextLabel) => {
      const nextRegex = new RegExp(`(?:^|\n)\s*${nextLabel}\s*:\s*`, 'i');
      const nextMatch = remainder.match(nextRegex);
      if (nextMatch && nextMatch.index !== undefined && nextMatch.index < endIndex) {
        endIndex = nextMatch.index;
      }
    });

    return remainder.slice(0, endIndex).trim();
  };

  const toList = (value) => String(value || '')
    .split(/\n+/)
    .map((line) => line.replace(/^[-*•\d.)\s]+/, '').trim())
    .filter((line) => {
      if (!line) return false;
      const lower = line.toLowerCase();
      return !lower.startsWith('we need to') &&
        !lower.startsWith('let\'s') &&
        !lower.startsWith('topic:') &&
        !lower.startsWith('debate:') &&
        !lower.startsWith('return only') &&
        !lower.startsWith('overall score') &&
        !lower.startsWith('summary:') &&
        !lower.startsWith('strengths:') &&
        !lower.startsWith('weaknesses:') &&
        !lower.startsWith('recommendations:') &&
        !/^item\s*\d+$/i.test(lower) &&
        !/^specific observation\s*\d+$/i.test(lower);
    })
    .slice(0, 5);

  const scoreMatch = cleaned.match(/Overall\s*Score\s*:\s*(\d+(?:\.\d+)?)/i) || cleaned.match(/Score\s*:\s*(\d+(?:\.\d+)?)/i);
  if (scoreMatch?.[1]) {
    sections.overall_score = Math.max(0, Math.min(10, Number(scoreMatch[1])));
  }

  const summary = readSection('Summary', ['Strengths', 'Weaknesses', 'Recommendations', 'Improvement', 'Improvements']);
  const strengths = readSection('Strengths', ['Weaknesses', 'Recommendations', 'Improvement', 'Improvements']);
  const weaknesses = readSection('Weaknesses', ['Recommendations', 'Improvement', 'Improvements']);
  const recommendations = readSection('Recommendations', ['Improvement', 'Improvements']);

  if (summary) sections.summary = summary;
  sections.strengths = toList(strengths);
  sections.weaknesses = toList(weaknesses);
  sections.recommendations = toList(recommendations);

  if (!sections.strengths.length && cleaned) {
    const positiveLine = cleaned.split(/\n+/).find((line) => {
      const lower = line.toLowerCase();
      return !lower.startsWith('we need to') && /\b(clarity|logic|engage|strong|good|effective|clear|specific)\b/i.test(line);
    });
    if (positiveLine) sections.strengths = [positiveLine.trim()];
  }

  if (!sections.weaknesses.length && cleaned) {
    const improvementLine = cleaned.split(/\n+/).find((line) => {
      const lower = line.toLowerCase();
      return !lower.startsWith('we need to') && /\b(improve|better|more|could|should|need|lacks|weak|tighten)\b/i.test(line);
    });
    if (improvementLine) sections.weaknesses = [improvementLine.trim()];
  }

  if (!sections.recommendations.length && cleaned) {
    sections.recommendations = sections.weaknesses.slice(0, 2);
  }

  return sections;
};

const extractDebateRebuttal = (text) => {
  const cleaned = cleanLlmText(text);
  if (!cleaned) return '';

  const exampleMatch = cleaned.match(/(?:example|e\.g\.)\s*:\s*"?([^"\n]{20,320})/i);
  if (exampleMatch?.[1]) {
    const exampleLine = exampleMatch[1].trim();
    if (exampleLine.length >= 20) {
      return exampleLine;
    }
  }

  const egCounterpointMatch = cleaned.match(/counterpoint\s*\(\s*e\.g\.,?\s*([^\)\n]{20,280})\)/i);
  if (egCounterpointMatch?.[1]) {
    const egLine = egCounterpointMatch[1].trim();
    if (egLine.length >= 20) {
      return egLine;
    }
  }

  const sentenceMatch = cleaned.match(/sentence\s*:\s*"?([^"\n]{20,320})/i);
  if (sentenceMatch?.[1]) {
    const sentenceLine = sentenceMatch[1].trim();
    if (sentenceLine.length >= 20) {
      return sentenceLine;
    }
  }

  const craftMatch = cleaned.match(/let'?s\s+craft\s*:\s*"?([^\n]{20,320})/i);
  if (craftMatch?.[1]) {
    const crafted = craftMatch[1].trim();
    if (crafted.length >= 20) {
      return crafted;
    }
  }

  const quotedMatches = [...cleaned.matchAll(/"([^"\n]{12,260})"/g)];
  if (quotedMatches.length > 0) {
    const quoted = quotedMatches
      .map((match) => match[1].trim())
      .filter((value) => value.length >= 12)
      .sort((a, b) => b.length - a.length)[0];
    if (quoted) return quoted;
  }

  const openEndedQuote = cleaned.match(/"([^"\n]{20,320})$/m);
  if (openEndedQuote?.[1]) {
    return openEndedQuote[1].trim();
  }

  const sentenceMatches = cleaned.match(/[^.!?]+[.!?]?/g) || [];
  const filteredSentences = sentenceMatches
    .map((part) => part.trim())
    .filter((part) => part.length >= 12)
    .filter((part) => !/^(we need to|let'?s|word count|count:|example:|sentence:|response requirements|topic:|current user argument:)/i.test(part))
    .filter((part) => !/(we need to|must be|output only|no labels|no bullets|instruction text|count words)/i.test(part));

  if (filteredSentences.length > 0) {
    return filteredSentences.sort((a, b) => b.length - a.length)[0];
  }

  return cleaned;
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

      if (options.returnRaw === true) {
        return text;
      }

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
          // If cleaning fails, keep only a valid sentence or fail so caller gets an explicit LLM error.
          const sentences = aiResponse.split(/[.!?]+/);
          const cleanedCandidate = sentences.find(s => !s.toLowerCase().includes('word') && s.trim().length > 10);
          if (cleanedCandidate) {
            aiResponse = `${cleanedCandidate.trim()}.`;
          } else {
            throw new Error('Unusable LLM response after cleaning');
          }
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
    const feedbackPromptVersion = 'v2';
    const speechHash = crypto.createHash('md5').update(JSON.stringify(speeches) + topic).digest('hex').substring(0, 8);
    const cacheKey = `feedback_${feedbackPromptVersion}_${speechHash}`;
    
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

    // Ask the LLM for a strict sectioned format that is easier to parse reliably.
    const feedbackPrompt = `Analyze this debate and return ONLY the following sections, with no markdown and no extra text. Every bullet must be specific to the transcript, not generic. Do NOT use placeholder words like item1/item2.\n\nOverall Score: 1-10\nSummary: 1-2 sentences\nStrengths:\n- specific observation 1\n- specific observation 2\nWeaknesses:\n- specific observation 1\n- specific observation 2\nRecommendations:\n- specific observation 1\n- specific observation 2\n\nTopic: ${topic}\nDebate (${speeches.length} turns):\n${speechText}`;

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

    const analysis = extractSectionedAnalysis(analysisText);
    
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

    return res.status(502).json({ 
      success: false, 
      error: 'LLM analysis unavailable',
      details: error.message
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

    return res.status(501).json({
      success: false,
      error: 'Gemini endpoint is disabled. Use analyze-openai for NVIDIA LLM feedback.'
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
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

    const prompt = `Topic: ${topic}\nCurrent claim: ${userArgument}\nRecent transcript:\n${conversationHistory}\n\nWrite only one natural counterpoint as the opposing debater. Use 1-2 sentences, 25-45 words. Attack one specific claim and give one concrete reason/example. Do not repeat the user's sentence. Do not add labels, analysis, or instructions.`;

    let aiResponse = "";
    let engineUsed = 'nvidia';

    const sanitizeCandidate = (text) => {
      if (!text) return '';
      return String(text)
        .replace(/^(AI:|Response:|Counter-Argument:|Argument:)/i, '')
        .replace(/^(e\.g\.,?|example\s*:)/i, '')
        .replace(/^(Opposing\s*:|Counterpoint\s*:|Reason\s*:)/gi, '')
        .replace(/\b(Opposing\s*:|Counterpoint\s*:|Reason\s*:)/gi, '')
        .replace(/let'?s count:?/gi, '')
        .replace(/\b([A-Za-z]+)\((\d+)\)/g, '$1')
        .replace(/\b([A-Za-z]+)(\d+)\b/g, '$1')
        .replace(/^["']+(.*?)["']+$/g, '$1')
        .replace(/["']+$/g, '')
        .replace(/\s{2,}/g, ' ')
        .trim();
    };

    const looksTruncated = (text) => {
      const value = String(text || '').trim();
      if (!value) return true;
      const words = value.split(/\s+/).filter(Boolean).length;
      if (words < 10) return true;
      if (/[.!?]$/.test(value)) return false;
      return /\b(and|or|to|with|for|of|that|which|a|an|the|work|life|more|less|because|as|by|from|in|on|at|than|while|when|who|why)\s*$/i.test(value);
    };

    const finalizeCandidate = (text) => {
      let value = sanitizeCandidate(text);
      if (!value) return '';

      const trailingConnectors = new Set([
        'and', 'or', 'to', 'with', 'for', 'of', 'that', 'which', 'a', 'an', 'the', 'as', 'by', 'from', 'in', 'on', 'at', 'than', 'while', 'when', 'who', 'why', 'because', 'compared', 'more', 'less'
      ]);

      let tokens = value.split(/\s+/).filter(Boolean);
      while (tokens.length > 10) {
        const tail = tokens[tokens.length - 1].toLowerCase().replace(/[^a-z0-9%]/g, '');
        if (!trailingConnectors.has(tail)) break;
        tokens.pop();
      }

      while (tokens.length > 10) {
        const rawTail = tokens[tokens.length - 1];
        const cleanTail = rawTail.toLowerCase().replace(/[^a-z0-9%]/g, '');
        const malformedTail = cleanTail.length <= 2 || /[\u2010\u2011\u2012\u2013\u2014\u2015-]$/.test(rawTail) || /[\u2010\u2011\u2012\u2013\u2014\u2015-][^\s]*$/.test(rawTail);
        if (!malformedTail) break;
        tokens.pop();
      }

      value = tokens.join(' ').replace(/\s{2,}/g, ' ').trim();
      if (value && !/[.!?]$/.test(value)) {
        value = `${value}.`;
      }
      return value;
    };

    const hasMetaLeak = (text) => {
      const lower = String(text || '').toLowerCase();
      return (
        lower.includes('first draft') ||
        lower.includes('meta talk') ||
        lower.includes('generic advice') ||
        lower.includes('return only') ||
        lower.includes('response requirements') ||
        lower.includes('user speech signals') ||
        lower.includes('argument analysis signals') ||
        lower.includes('rewrite the answer') ||
        lower.includes('you are the user') ||
        lower.includes('we are the user') ||
        lower.includes("let's count") ||
        lower.includes('word count') ||
        lower.includes('count:') ||
        lower.startsWith('count ') ||
        lower.includes(' count ') ||
        lower.includes('we need') ||
        lower.includes('let\'s craft') ||
        lower.includes('example:') ||
        lower.includes('sentence:') ||
        /\b[a-z]+\(\d+\)/i.test(lower) ||
        /\b[a-z]+\d+\b/i.test(lower)
      );
    };
    
    try {
      console.log(`[getAIResponse] Calling NVIDIA for turn ${debateContext ? debateContext.length : 1}`);
      
      const claimKeywords = extractKeywords(userArgument, 5).slice(0, 6);
      const normalizeForCompare = (value) => String(value || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
      const normalizedUserArgument = normalizeForCompare(userArgument);
      const normalizedRecentUserClaims = normalizedContext
        .filter((item) => String(item?.speaker || '').toLowerCase() !== 'ai')
        .map((item) => normalizeForCompare(item?.text || ''))
        .filter(Boolean)
        .slice(-6);
      const echoPool = [...new Set([normalizedUserArgument, ...normalizedRecentUserClaims].filter(Boolean))];

      const tokenOverlap = (a, b) => {
        const aTokens = new Set(String(a || '').split(/\s+/).filter((t) => t.length > 2));
        const bTokens = new Set(String(b || '').split(/\s+/).filter((t) => t.length > 2));
        if (!aTokens.size || !bTokens.size) return 0;
        const intersection = [...aTokens].filter((t) => bTokens.has(t)).length;
        const union = new Set([...aTokens, ...bTokens]).size;
        return union === 0 ? 0 : intersection / union;
      };

      const buildNgrams = (value, n = 3) => {
        const tokens = String(value || '').split(/\s+/).filter((t) => t.length > 2);
        const grams = [];
        for (let i = 0; i <= tokens.length - n; i += 1) {
          grams.push(tokens.slice(i, i + n).join(' '));
        }
        return grams;
      };

      const sameLeadingTokens = (a, b, count = 4) => {
        const aHead = String(a || '').split(/\s+/).filter(Boolean).slice(0, count).join(' ');
        const bHead = String(b || '').split(/\s+/).filter(Boolean).slice(0, count).join(' ');
        return aHead.length > 0 && aHead === bHead;
      };

      const scoreResponse = (text) => {
        const aiWordCount = text.split(/\s+/).filter(Boolean).length;
        const responseTopicRelevance = calculateKeywordRelevance(text, topicKeywords);
        const claimRelevance = calculateKeywordRelevance(text, claimKeywords);
        const normalizedText = normalizeForCompare(text);
        const responseTrigrams = new Set(buildNgrams(normalizedText, 3));
        let maxEchoOverlap = 0;
        const isEchoingUser = echoPool.some((claim) => {
          if (!claim) return false;
          if (normalizedText === claim || normalizedText.startsWith(claim) || claim.startsWith(normalizedText)) {
            return true;
          }

          const claimTrigrams = buildNgrams(claim, 3);
          if (claimTrigrams.length >= 2) {
            const trigramMatches = claimTrigrams.filter((gram) => responseTrigrams.has(gram)).length;
            if (trigramMatches >= 2) {
              return true;
            }
          }

          const overlap = tokenOverlap(normalizedText, claim);
          if (overlap > maxEchoOverlap) maxEchoOverlap = overlap;
          return overlap >= 0.45 || sameLeadingTokens(normalizedText, claim, 4);
        });
        const isAgreeing = /\b(i\s+agree|you\s+are\s+right|you\s+make\s+a\s+good\s+point|exactly)\b/i.test(text);
        const qualityScore = (claimRelevance * 0.5) + (responseTopicRelevance * 0.3) + (Math.min(aiWordCount, 45) / 45 * 0.2);

        return {
          aiWordCount,
          responseTopicRelevance,
          claimRelevance,
          maxEchoOverlap,
          qualityScore,
          hasMetaLeak: hasMetaLeak(text),
          isEchoingUser,
          isAgreeing,
          needsRetry: aiWordCount < 8 || aiWordCount > 120 || (responseTopicRelevance < 0.03 && claimRelevance < 0.02) || hasMetaLeak(text) || isEchoingUser || isAgreeing
        };
      };

      const attemptSpecs = [
        {
          prompt,
          options: {
            systemPrompt: 'You are a real debate opponent. Output only rebuttal text in 1-2 sentences. No labels, no planning, no counting, no explanations.',
            maxTokens: 110,
            temperature: 0.55,
            topP: 0.9,
            presencePenalty: 0.5,
            frequencyPenalty: 0.45,
            returnRaw: true
          },
          engine: 'nvidia'
        },
        {
          prompt: `Debate topic: ${topic}\nUser claim: ${userArgument}\n\nRespond as the opposing debater in exactly 1-2 sentences. Give one direct counterpoint and one reason. Do not repeat the user sentence. Do not write words like Count, Example, Sentence, Topic, or any instruction text.`,
          options: {
            systemPrompt: 'Return only a natural rebuttal line. Never include prompt analysis, planning notes, word counts, or labels.',
            maxTokens: 110,
            temperature: 0.45,
            topP: 0.85,
            presencePenalty: 0.45,
            frequencyPenalty: 0.5,
            returnRaw: true
          },
          engine: 'nvidia-retry-1'
        },
        {
          prompt: `Topic: ${topic}\nClaim to counter: ${userArgument}\n\nOutput only one concise rebuttal (25-45 words). Directly disagree and provide a concrete causal reason. No bullets. No prefixes. No planning text.`,
          options: {
            systemPrompt: 'Debate opponent mode. Output exactly one short counter-argument sentence block, and nothing else.',
            maxTokens: 95,
            temperature: 0.35,
            topP: 0.8,
            presencePenalty: 0.4,
            frequencyPenalty: 0.55,
            returnRaw: true
          },
          engine: 'nvidia-retry-2'
        }
      ];

      let bestAttempt = null;
      let bestUsableAttempt = null;

      for (const spec of attemptSpecs) {
        const raw = await callNvidiaAPI(spec.prompt, nvidiaApiKey, nvidiaApiUrl, nvidiaModel, spec.options);
        const extracted = extractDebateRebuttal(raw);
        let candidate = sanitizeCandidate(extracted);

        // If strict extraction misses, keep a sanitized raw fallback candidate from the same LLM output.
        if (!candidate) {
          candidate = sanitizeCandidate(cleanLlmText(raw));
        }

          if (!candidate) {
          continue;
        }

        const quality = scoreResponse(candidate);
        console.log(`[getAIResponse] Attempt ${spec.engine} candidate:`, candidate);
        console.log(`[getAIResponse] Attempt ${spec.engine} quality:`, quality);
        if (!bestAttempt || quality.qualityScore > bestAttempt.quality.qualityScore) {
          bestAttempt = { candidate, quality, engine: spec.engine };
        }

        if (!quality.isEchoingUser && !quality.hasMetaLeak && quality.aiWordCount >= 8) {
          if (!bestUsableAttempt || quality.qualityScore > bestUsableAttempt.quality.qualityScore) {
            bestUsableAttempt = { candidate, quality, engine: spec.engine };
          }
        }

        if (!quality.needsRetry) {
          aiResponse = candidate;
          engineUsed = spec.engine;
          break;
        }
      }

      if (!aiResponse && bestUsableAttempt) {
        aiResponse = bestUsableAttempt.candidate;
        engineUsed = `${bestUsableAttempt.engine}-soft`;
        console.warn('[getAIResponse] Returning best extracted LLM attempt with soft quality:', bestUsableAttempt.quality);
      }

      if (aiResponse && looksTruncated(aiResponse)) {
        try {
          const repairedRaw = await callNvidiaAPI(
            `Rewrite this debate rebuttal draft into one complete natural counterpoint sentence (20-40 words). Keep the same meaning, but make it fluent and complete. Output only the final sentence.\n\nDraft: ${aiResponse}`,
            nvidiaApiKey,
            nvidiaApiUrl,
            nvidiaModel,
            {
              systemPrompt: 'You rewrite debate rebuttal drafts into one complete sentence. Output only final rebuttal text. No planning or labels.',
              maxTokens: 90,
              temperature: 0.25,
              topP: 0.8,
              presencePenalty: 0.2,
              frequencyPenalty: 0.2,
              returnRaw: true
            }
          );
          const repairedCandidate = sanitizeCandidate(extractDebateRebuttal(repairedRaw));
          const repairedQuality = scoreResponse(repairedCandidate);
          if (repairedCandidate && !repairedQuality.hasMetaLeak && !repairedQuality.isEchoingUser && repairedQuality.aiWordCount >= 10) {
            aiResponse = repairedCandidate;
            engineUsed = `${engineUsed}-repair`;
          }
        } catch (repairError) {
          console.warn('[getAIResponse] Repair pass failed:', repairError.message);
        }
      }

      if (!aiResponse) {
        throw new Error('LLM response unavailable after 3 attempts');
      }

      aiResponse = finalizeCandidate(aiResponse);
      
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

    res.status(502).json({
      success: false,
      error: 'LLM response unavailable',
      details: error.message
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

      return res.status(502).json({
        success: false,
        isValid: false,
        error: 'Topic validation unavailable',
        details: nvidiaError.message
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

      return res.status(502).json({ 
        success: false,
        error: 'Multi-participant LLM analysis unavailable',
        details: llmError.message,
        participantCount: participants.length,
        speechCount: speeches.length
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
