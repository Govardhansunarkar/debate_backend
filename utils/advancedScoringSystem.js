/**
 * Advanced Argument Quality and Scoring System
 * Scores based on meaning and argument quality, NOT length
 */

// Analyze argument quality based on rhetorical techniques and evidence
const analyzeArgumentQuality = (speechText) => {
  if (!speechText || speechText.length === 0) {
    return { score: 0, breakdown: {} };
  }

  const text = String(speechText).toLowerCase();
  const wordCount = text.split(/\s+/).length;

  let score = 0;
  const breakdown = {
    hasEvidence: 0,
    hasLogicalStructure: 0,
    addressesCounterpoint: 0,
    specificity: 0,
    academicTone: 0,
    clarity: 0,
    persuasiveness: 0
  };

  // 1. EVIDENCE & DATA (25 points max)
  const evidenceKeywords = [
    "study", "research", "data", "statistics", "found", "shows", "proved",
    "evidence", "fact", "research shows", "according to", "scientists",
    "reported", "demonstrated", "survey", "analysis", "percentage",
    "report", "study found", "research indicates", "findings"
  ];
  const evidenceCount = evidenceKeywords.filter(kw => text.includes(kw)).length;
  if (evidenceCount > 0) {
    breakdown.hasEvidence = Math.min(evidenceCount * 5, 25);
    score += breakdown.hasEvidence;
  }

  // 2. LOGICAL STRUCTURE (20 points max)
  const logicKeywords = [
    "therefore", "thus", "because", "since", "leads to", "results in",
    "causes", "implies", "conclusion", "reason", "logic", "logically",
    "consequently", "as a result", "this means", "ultimately",
    "so that", "in order to", "furthermore", "moreover"
  ];
  const logicCount = logicKeywords.filter(kw => text.includes(kw)).length;
  if (logicCount > 0) {
    breakdown.hasLogicalStructure = Math.min(logicCount * 4, 20);
    score += breakdown.hasLogicalStructure;
  }

  // 3. ADDRESSES COUNTERPOINTS (20 points max)
  const counterKeywords = [
    "however", "but", "although", "yet", "conversely",
    "on the other hand", "alternatively", "despite",
    "though", "granted", "true, but", "i disagree",
    "that's not quite right", "actually", "in reality",
    "you said", "your point", "your argument", "my opponent"
  ];
  const counterCount = counterKeywords.filter(kw => text.includes(kw)).length;
  if (counterCount > 0) {
    breakdown.addressesCounterpoint = Math.min(counterCount * 5, 20);
    score += breakdown.addressesCounterpoint;
  }

  // 4. SPECIFICITY & EXAMPLES (15 points max)
  const specificityKeywords = [
    "example", "for instance", "such as", "specifically",
    "in particular", "case", "instance", "like", "like when",
    "happened", "occurred", "proven by", "demonstrated by",
    "as seen in", "look at", "consider", "take", "year",
    "study: ", "found that"
  ];
  const specificityCount = specificityKeywords.filter(kw => text.includes(kw)).length;
  if (specificityCount > 0) {
    breakdown.specificity = Math.min(specificityCount * 3, 15);
    score += breakdown.specificity;
  }

  // 5. ACADEMIC/FORMAL TONE (10 points)
  const academicKeywords = [
    "furthermore", "moreover", "nevertheless", "regarding",
    "concerning", "substantial", "significant", "critical",
    "impact", "framework", "perspective", "aspect", "domain",
    "comprehensive", "fundamental", "fundamental issue"
  ];
  const academicCount = academicKeywords.filter(kw => text.includes(kw)).length;
  if (academicCount > 0) {
    breakdown.academicTone = Math.min(academicCount * 2, 10);
    score += breakdown.academicTone;
  }

  // 6. CLARITY (5 points)
  // Bonus if answer is concise but meaningful (20-100 words is sweet spot)
  if (wordCount >= 15 && wordCount <= 100) {
    breakdown.clarity = 5;
    score += 5;
  } else if (wordCount >= 10 && wordCount <= 150) {
    breakdown.clarity = 3;
    score += 3;
  }

  // 7. PERSUASIVENESS (5 points)
  const persuasiveKeywords = [
    "proven", "undeniable", "clear", "obvious", "definitely",
    "absolutely", "definitely shows", "demonstrate clearly",
    "must", "should", "critical", "essential", "vital"
  ];
  const persuasiveCount = persuasiveKeywords.filter(kw => text.includes(kw)).length;
  if (persuasiveCount > 0) {
    breakdown.persuasiveness = Math.min(persuasiveCount * 2, 5);
    score += breakdown.persuasiveness;
  }

  return {
    score: Math.min(Math.round(score), 100),
    breakdown,
    wordCount,
    hasContent: wordCount > 10,
    isHighQuality: score > 50
  };
};

// Calculate points based on argument quality instead of length
const calculateQualityBasedPoints = (speechText) => {
  const analysis = analyzeArgumentQuality(speechText);
  
  // New scoring system:
  // Base: 0 points
  // Quality: 0-50 points based on analysis
  // Multiplier based on quality tiers:
  
  let points = 0;
  
  if(!analysis.hasContent) {
    // Too short to be meaningful
    points = 2;
  } else if (analysis.score < 20) {
    // Low quality - just stating opinion
    points = 3;
  } else if (analysis.score < 40) {
    // Medium quality - some structure but lacking evidence
    points = 10;
  } else if (analysis.score < 60) {
    // Good quality - has logic and some evidence
    points = 15;
  } else if (analysis.score < 80) {
    // High quality - strong structure, evidence, and counterpoint addressing
    points = 25;
  } else {
    // Excellent quality - comprehensive, well-structured, evidence-based
    points = 35;
  }
  
  return {
    points: Math.min(points, 40), // Max 40 points per turn
    qualityScore: analysis.score,
    analysis: analysis
  };
};

// Get point deduction for weak arguments
const getWeakArgumentPenalty = (speechText) => {
  const text = String(speechText).toLowerCase();
  
  // Common weak argument patterns
  const weakPatterns = [
    "i think", "i believe", "in my opinion", "i feel",
    "maybe", "might", "could be", "sort of", "kind of",
    "umm", "uh", "like", "basically", "literally"
  ];
  
  let weakCount = 0;
  weakPatterns.forEach(pattern => {
    const regex = new RegExp(`\\b${pattern}\\b`, 'g');
    weakCount += (text.match(regex) || []).length;
  });
  
  // Penalty: up to 10 points deorted for weak language
  return Math.min(weakCount * 2, 10);
};

module.exports = {
  analyzeArgumentQuality,
  calculateQualityBasedPoints,
  getWeakArgumentPenalty
};
