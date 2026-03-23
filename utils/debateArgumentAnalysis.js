/**
 * Debate Argument Analysis Module
 * Analyzes user arguments to generate intelligent counterpoints
 */

// Extract key claims from argument
const extractClaims = (argument) => {
  const sentences = argument.split(/[.!?]+/).filter(s => s.trim());
  return sentences.map(s => s.trim());
};

// Identify argument strength indicators
const analyzeArgumentStrength = (argument) => {
  const lowerArg = argument.toLowerCase();
  
  let strength = 0;
  let analysis = [];
  
  // Evidence/research keywords
  const evidenceKeywords = ["study", "research", "evidence", "data", "found", "shows", "proves", "demonstrated"];
  const hasEvidence = evidenceKeywords.some(kw => lowerArg.includes(kw));
  if (hasEvidence) {
    strength += 2;
    analysis.push("evidence-based");
  }
  
  // Logic keywords
  const logicKeywords = ["therefore", "because", "thus", "hence", "so", "as a result", "implies"];
  const hasLogic = logicKeywords.some(kw => lowerArg.includes(kw));
  if (hasLogic) {
    strength += 2;
    analysis.push("logical-flow");
  }
  
  // Examples/specificity
  const hasExamples = /\b(for instance|for example|e\.g|specifically|case|instance)\b/i.test(argument);
  if (hasExamples) {
    strength += 1;
    analysis.push("specific-examples");
  }
  
  // Counterpoint acknowledgment
  const hasCounterpoint = /\b(however|although|despite|while|yet|but)\b/i.test(argument);
  if (hasCounterpoint) {
    strength += 1;
    analysis.push("acknowledges-counterpoint");
  }
  
  // Word count indicator
  const wordCount = argument.split(/\s+/).length;
  if (wordCount < 15) {
    analysis.push("short-argument");
  } else if (wordCount > 50) {
    analysis.push("detailed-argument");
    strength += 1;
  }
  
  return {
    strength,
    analysis,
    wordCount
  };
};

// Generate strategic counter-argument suggestions
const generateCounterStrategy = (userArgument, topic, debateContext) => {
  const argumentAnalysis = analyzeArgumentStrength(userArgument);
  
  let strategy = {
    approach: "",
    focus: [],
    techniques: []
  };
  
  // If argument lacks evidence, attack on evidence
  if (!argumentAnalysis.analysis.includes("evidence-based")) {
    strategy.focus.push("lack of evidence");
    strategy.techniques.push("demand empirical support");
  }
  
  // If no logical flow, attack on logic
  if (!argumentAnalysis.analysis.includes("logical-flow")) {
    strategy.focus.push("logical gaps");
    strategy.techniques.push("identify non-sequiturs");
  }
  
  // If too short/vague, demand specificity
  if (argumentAnalysis.analysis.includes("short-argument")) {
    strategy.focus.push("lack of specificity");
    strategy.techniques.push("ask for concrete examples");
  }
  
  // Check previous context for contradictions
  if (debateContext && debateContext.length > 0) {
    strategy.focus.push("consistency with prior claims");
    strategy.techniques.push("highlight contradictions");
  }
  
  // Determine approach based on argument strength
  if (argumentAnalysis.strength <= 2) {
    strategy.approach = "aggressive";
    strategy.techniques.push("directly challenge");
  } else if (argumentAnalysis.strength <= 4) {
    strategy.approach = "balanced";
    strategy.techniques.push("respectfully disagree");
    strategy.techniques.push("present counter-evidence");
  } else {
    strategy.approach = "nuanced";
    strategy.techniques.push("acknowledge strengths");
    strategy.techniques.push("focus on overlooked aspects");
  }
  
  return strategy;
};

// Identify topic-specific counterpoints
const getTopicSpecificCounterpoints = (topic) => {
  const topics = {
    "social media": {
      counterpoints: [
        "suppresses misinformation",
        "enables social movements",
        "facilitates global connection",
        "improves business innovation"
      ],
      weaknesses: ["addiction", "mental health", "privacy issues"]
    },
    "artificial intelligence": {
      counterpoints: [
        "creates new job categories",
        "improves healthcare outcomes",
        "enhances efficiency",
        "accelerates research"
      ],
      weaknesses: ["job displacement", "bias in algorithms", "ethical concerns"]
    },
    "remote work": {
      counterpoints: [
        "increases work-life balance",
        "reduces commute stress",
        "expands talent pool",
        "improves productivity"
      ],
      weaknesses: ["communication challenges", "collaboration difficulties", "isolation"]
    },
    "climate change": {
      counterpoints: [
        "clean energy creates jobs",
        "medical costs decrease",
        "ecosystem preservation",
        "technological innovation"
      ],
      weaknesses: ["economic transition costs", "technological limitations"]
    }
  };
  
  const topicLower = topic.toLowerCase();
  
  for (const [key, value] of Object.entries(topics)) {
    if (topicLower.includes(key)) {
      return {
        counterpoints: value.counterpoints,
        weaknesses: value.weaknesses
      };
    }
  }
  
  return null;
};

// Build a comprehensive argument analysis
const analyzeDebateArgument = (userArgument, topic, debateContext) => {
  return {
    claims: extractClaims(userArgument),
    strength: analyzeArgumentStrength(userArgument),
    strategy: generateCounterStrategy(userArgument, topic, debateContext),
    topicPoints: getTopicSpecificCounterpoints(topic),
    turnNumber: debateContext ? debateContext.length : 0
  };
};

module.exports = {
  extractClaims,
  analyzeArgumentStrength,
  generateCounterStrategy,
  getTopicSpecificCounterpoints,
  analyzeDebateArgument
};
