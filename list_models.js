const https = require('https');

const GEMINI_API_KEY = 'AIzaSyAv8-xg80DLwhhYKdA6_j9ZIvwtVwvW3kc';
const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${GEMINI_API_KEY}`;

console.log('Fetching models list...');
https.get(url, (res) => {
  let data = '';
  res.on('data', (chunk) => {
    data += chunk;
  });
  
  res.on('end', () => {
    try {
      const response = JSON.parse(data);
      console.log('STATUS CODE:', res.statusCode);
      if (response.models) {
        console.log('Supported Models:');
        response.models.forEach(model => {
          console.log(`- Name: ${model.name}`);
          console.log(`  DisplayName: ${model.displayName}`);
          console.log(`  SupportedMethods: ${model.supportedGenerationMethods.join(', ')}`);
        });
      } else {
        console.log('No models key found in response:', response);
      }
    } catch (err) {
      console.error('Failed to parse response JSON:', err);
      console.log('Raw response:', data);
    }
  });
}).on('error', (err) => {
  console.error('Request failed:', err);
});
