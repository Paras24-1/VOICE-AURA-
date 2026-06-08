const https = require('https');
const path = require('path');
const dotenv = require('dotenv');

// Load environment variables from .env.local
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
if (!GEMINI_API_KEY) {
  console.error('Error: GEMINI_API_KEY is not defined in environment variables.');
  process.exit(1);
}
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
