const axios = require('axios');

const testAPI = async () => {
  try {
    console.log('[Test] Calling API endpoint...');
    
    const response = await axios.post('http://localhost:3001/api/debates/ai-response', {
      userArgument: "I think school uniforms should be mandatory to reduce bullying.",
      topic: "School Uniforms",
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
