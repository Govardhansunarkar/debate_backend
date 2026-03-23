const axios = require('axios');

const testAPI = async () => {
  try {
    console.log('[Test] Calling API endpoint...');
    
    const response = await axios.post('http://localhost:8000/api/debates/ai-response', {
      userArgument: "Renewable energy is better than fossil fuels because it reduces carbon emissions",
      topic: "Energy Future",
      debateContext: []
    });

    console.log('[Test] Response received:');
    console.log(JSON.stringify(response.data, null, 2));
  } catch (error) {
    console.error('[Test] Error:', error.message);
    if (error.response) {
      console.error('[Test] Response data:', error.response.data);
    }
  }
};

testAPI();
