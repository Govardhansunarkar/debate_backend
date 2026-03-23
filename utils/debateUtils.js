const generateRoomCode = () => {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
};

const generateTeams = (players, numTeams = 2) => {
  const teams = Array.from({ length: numTeams }, () => []);
  players.forEach((player, index) => {
    teams[index % numTeams].push(player);
  });
  return teams;
};

const generateTopics = () => {
  const topics = [
    'Artificial Intelligence will replace human jobs',
    'Social media has more negative than positive effects',
    'Remote work is more productive than office work',
    'Nuclear energy is the solution to climate change',
    'Universal basic income should be implemented',
    'Space exploration is worth the investment',
    'Video games negatively affect children',
    'Cryptocurrencies are the future of finance',
    'Privacy is more important than security',
    'Education should be free for everyone',
    'Animals should have legal rights',
    'Fast fashion should be banned',
    'Mental health is as important as physical health'
  ];
  return topics[Math.floor(Math.random() * topics.length)];
};

const calculateScore = (debate) => {
  const scores = {};
  debate.players.forEach(player => {
    const playerMessages = debate.messages.filter(m => m.userId === player.id);
    const score = {
      communication: 70 + Math.random() * 30,
      logic: 65 + Math.random() * 35,
      confidence: 75 + Math.random() * 25,
      rebuttal: 60 + Math.random() * 40
    };
    scores[player.id] = score;
  });
  return scores;
};

module.exports = {
  generateRoomCode,
  generateTeams,
  generateTopics,
  calculateScore
};
