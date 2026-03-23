/**
 * Advanced Debate Response Engine
 * Generates intelligent, context-aware debate responses that:
 * - Build on previous counterpoints
 * - Attack argument weaknesses
 * - Reference previous debate history
 * - Maintain logical consistency
 */

// Identify key points/claims in an argument
const extractMainClaims = (text) => {
  const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 10);
  return sentences.map(s => s.trim());
};

// Find contradictions between arguments
const findContradictions = (userArgument, debateHistory) => {
  if (!debateHistory || debateHistory.length === 0) return [];
  
  const userArgLower = userArgument.toLowerCase();
  const contradictions = [];
  
  // Look through history for opposing statements
  debateHistory.forEach((item, idx) => {
    if (item.speaker === "user" && idx < debateHistory.length - 1) {
      const prevStatement = item.text.toLowerCase();
      
      // Check for logical contradictions
      const opposites = ["should not", "should", "bad", "good", "wrong", "right", "impossible", "possible"];
      opposites.forEach(word => {
        if (prevStatement.includes(word) && userArgLower.includes(word)) {
          contradictions.push({
            turn: idx,
            previousStatement: item.text,
            currentStatement: userArgument
          });
        }
      });
    }
  });
  
  return contradictions;
};

// Generate counterargument that attacks specific logical weaknesses
const generateCounterAttack = (userArgument, topic, debateContext = []) => {
  const turnNumber = debateContext.length;
  const contradictions = findContradictions(userArgument, debateContext);
  
  // Extract what they claimed
  const claims = extractMainClaims(userArgument);
  const mainClaim = claims[0] || userArgument;
  
  // Different attack strategies based on debate progression
  const attackStrategies = {
    earlyGame: {
      stage: "opening",
      strategies: [
        `You claim "${mainClaim.substring(0, 50)}..." but that ignores the fundamental issue: ${topic} has multiple dimensions you haven't addressed.`,
        `While "${mainClaim.substring(0, 50)}..." sounds appealing, the reality is far more complex. Consider that the opposite actually creates better outcomes.`,
        `Your argument assumes "${mainClaim.substring(0, 50)}..." but historically, this leads to contradictory results.`,
        `That's a one-sided view. "${mainClaim.substring(0, 50)}..." fails to account for the systemic consequences.`,
        `I disagree fundamentally. "${mainClaim.substring(0, 50)}..." is based on a false premise that I can disprove.`
      ]
    },
    midGame: {
      stage: "development",
      strategies: [
        `You're repeating the same flawed argument. I already showed that "${mainClaim.substring(0, 50)}..." leads to the opposite effect.`,
        `Building on my earlier point, your claim "${mainClaim.substring(0, 50)}..." directly contradicts what you said two turns ago.`,
        `That argument fails because it ignores the counterpoint I raised. The evidence actually shows "${mainClaim.substring(0, 50)}..." is false.`,
        `You're not addressing my core rebuttal. "${mainClaim.substring(0, 50)}..." doesn't account for what I already proved.`,
        `Your evidence is weak. "${mainClaim.substring(0, 50)}..." has been disproven by multiple studies and real-world examples.`
      ]
    },
    endGame: {
      stage: "closing",
      strategies: [
        `After all this debate, your position on "${mainClaim.substring(0, 50)}..." still lacks credible support.`,
        `In conclusion, your argument "${mainClaim.substring(0, 50)}..." has been systematically dismantled throughout this debate.`,
        `You haven't been able to defend "${mainClaim.substring(0, 50)}..." against my counterarguments. This shows the weakness of your position.`,
        `Your final argument "${mainClaim.substring(0, 50)}..." contradicts the evidence we've already discussed.`,
        `I've proven that "${mainClaim.substring(0, 50)}..." is false. Your position cannot withstand scrutiny.`
      ]
    }
  };
  
  // Determine game stage
  let stage = "earlyGame";
  if (turnNumber > 8) stage = "endGame";
  else if (turnNumber > 4) stage = "midGame";
  
  const possibleResponses = attackStrategies[stage].strategies;
  
  // If we found contradictions, use them
  if (contradictions.length > 0) {
    const contradiction = contradictions[0];
    return `You previously said "${contradiction.previousStatement.substring(0, 40)}..." but now you're saying "${mainClaim.substring(0, 50)}?" Those positions are contradictory, which undermines your argument.`;
  }
  
  return possibleResponses[Math.floor(Math.random() * possibleResponses.length)];
};

// Generate responses that reference specific debate context
const generateContextualResponse = (userArgument, topic, debateContext = []) => {
  const turnNumber = debateContext.length;
  
  // Build reference to previous AI arguments
  let previousAIPoint = null;
  for (let i = debateContext.length - 1; i >= 0; i--) {
    if (debateContext[i].speaker === "ai") {
      previousAIPoint = debateContext[i];
      break;
    }
  }
  
  const responses = [];
  
  // Type 1: Direct attack on their argument
  responses.push({
    type: "direct-attack",
    response: `Your claim that "${userArgument.substring(0, 60)}..." is fundamentally flawed because it ignores the practical implications we should consider.`,
    weight: 1.2
  });
  
  // Type 2: Reference previous point and build counter
  if (previousAIPoint) {
    responses.push({
      type: "building-on-previous",
      response: `Building on my earlier point about this topic, your argument "${userArgument.substring(0, 50)}..." actually reinforces why my position is correct.`,
      weight: 1.5
    });
  }
  
  // Type 3: Logical inconsistency attack
  responses.push({
    type: "logical-attack",
    response: `The logic in "${userArgument.substring(0, 60)}..." breaks down when you consider what actually happens in practice. The outcome is the opposite of what you claim.`,
    weight: 1.3
  });
  
  // Type 4: Evidence-based counter
  responses.push({
    type: "evidence-counter",
    response: `That contradicts established evidence on ${topic}. Research actually shows "${userArgument.substring(0, 50)}..." leads to different results than you're claiming.`,
    weight: 1.4
  });
  
  // Type 5: Philosophical/systemic counter
  responses.push({
    type: "systemic-counter",
    response: `You're looking at this too narrowly. "${userArgument.substring(0, 50)}..." fails to address the bigger systemic issues that make your argument untenable.`,
    weight: 1.2
  });
  
  // Type 6: Turn their argument against them
  if (userArgument.length > 30) {
    responses.push({
      type: "reversal",
      response: `Interestingly, the evidence you're using actually proves the opposite. "${userArgument.substring(0, 50)}..." is exactly why my position is stronger.`,
      weight: 1.6
    });
  }
  
  // Late game - stronger attacks
  if (turnNumber > 6) {
    responses.push({
      type: "late-game-attack",
      response: `By now, it should be clear that "${userArgument.substring(0, 50)}..." has been thoroughly demonstrated to be incorrect. I've provided multiple counterexamples.`,
      weight: 1.7
    });
  }
  
  // Weight random selection by strength
  const totalWeight = responses.reduce((sum, r) => sum + r.weight, 0);
  let random = Math.random() * totalWeight;
  
  for (const response of responses) {
    random -= response.weight;
    if (random <= 0) {
      return response.response;
    }
  }
  
  return responses[Math.floor(Math.random() * responses.length)].response;
};

// Main debate response generator - SMART VERSION
const generateSmartDebateResponse = (userArgument, topic, debateContext = []) => {
  // Combine multiple strategies
  const attackResponse = generateCounterAttack(userArgument, topic, debateContext);
  const contextualResponse = generateContextualResponse(userArgument, topic, debateContext);
  
  // 60% chance of stronger counter attack, 40% chance of contextual reference
  if (Math.random() > 0.4) {
    return attackResponse;
  } else {
    return contextualResponse;
  }
};

// Advanced engine that builds debate arguments progressively
const buildProgressiveDebateResponse = (userArgument, topic, debateContext = []) => {
  const turnNumber = debateContext.length;
  
  // Get all user claims throughout debate
  const userClaims = debateContext
    .filter(item => item.speaker === "user")
    .map(item => item.text);
  
  // Get all AI responses
  const aiResponses = debateContext
    .filter(item => item.speaker === "ai")
    .map(item => item.text);
  
  // Analyze current argument for novelty
  const currentClaims = extractMainClaims(userArgument);
  const isRepeat = userClaims.some(oldClaim => 
    currentClaims.some(newClaim => 
      oldClaim.toLowerCase().includes(newClaim.toLowerCase())
    )
  );
  
  let response;
  
  if (isRepeat && aiResponses.length > 0) {
    // They're repeating - call them out
    response = `You already made that argument, and I already refuted it. You haven't presented any new evidence. The point remains: "${userArgument.substring(0, 60)}..." is incorrect, as I demonstrated.`;
  } else {
    // New argument - mount fresh attack
    response = generateSmartDebateResponse(userArgument, topic, debateContext);
  }
  
  return response;
};

module.exports = {
  generateCounterAttack,
  generateContextualResponse,
  generateSmartDebateResponse,
  buildProgressiveDebateResponse,
  extractMainClaims,
  findContradictions
};
