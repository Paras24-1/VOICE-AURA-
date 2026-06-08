const WebSocket = require('ws');

const GEMINI_API_KEY = 'AIzaSyAv8-xg80DLwhhYKdA6_j9ZIvwtVwvW3kc';
const geminiModel = 'models/gemini-2.5-flash';
const geminiUrl = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${GEMINI_API_KEY}`;

console.log('Connecting to Gemini WebSocket (v1beta with gemini-2.5-flash)...');
const ws = new WebSocket(geminiUrl);

ws.on('open', () => {
  console.log('CONNECTED successfully. Sending setup...');
  
  const setupMessage = {
    setup: {
      model: geminiModel,
      generationConfig: {
        responseModalities: ["AUDIO"],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: {
              voiceName: "Aoede"
            }
          }
        }
      },
      systemInstruction: {
        parts: [
          {
            text: 'You are a helpful voice assistant.'
          }
        ]
      }
    }
  };
  
  ws.send(JSON.stringify(setupMessage));
  console.log('Setup message sent. Waiting for response...');
  
  setTimeout(() => {
    console.log('Closing connection...');
    ws.close();
    process.exit(0);
  }, 4000);
});

ws.on('message', (data) => {
  console.log('RECEIVED MESSAGE:', data.toString());
});

ws.on('close', (code, reason) => {
  console.log(`CLOSED: Code=${code}, Reason=${reason.toString()}`);
});

ws.on('error', (err) => {
  console.error('ERROR occurred:', err);
});
