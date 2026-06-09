// Standalone Real-time WebSocket Audio Streaming Server Gateway
// Integrates Twilio/WebRTC clients with Gemini Multimodal Live API
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const dotenv = require('dotenv');

// Load environment variables from Next.js .env.local file
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const { createClient } = require('@supabase/supabase-js');
const { mulawToPcm16, pcm24ToMulaw, pcm16ToMulaw, pcm8ToPcm16, pcm24ToPcm8 } = require('./src/lib/audio/transcoder');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ noServer: true });

const PORT = process.env.PORT || 5050;

// Initialize Supabase Client with service role to bypass RLS for logging
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
let supabase = null;

if (supabaseUrl && supabaseServiceKey) {
  supabase = createClient(supabaseUrl, supabaseServiceKey);
  console.log('[Supabase] Client initialized successfully.');
} else {
  console.warn('[Supabase] Warning: Missing credentials. Call logs will not be persisted.');
}

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// TwiML Route for Twilio inbound calls
app.post('/api/twilio/incoming', async (req, res) => {
  const agentId = req.query.agentId || 'default';
  console.log(`[Twilio] Incoming call received, routing to agent: ${agentId}`);
  
  const host = req.headers.host;
  const protocol = req.headers['x-forwarded-proto'] === 'https' ? 'wss' : 'ws';
  
  res.type('text/xml');
  res.send(`<?xml version="1.5" encoding="UTF-8"?>
<Response>
  <Say voice="alice" language="en-US">Connecting you to Aura Voice assistant...</Say>
  <Connect>
    <Stream url="${protocol}://${host}/media-stream?agentId=${agentId}" />
  </Connect>
</Response>`);
});

// VoiceXML Route for Vobiz inbound calls
app.post('/api/vobiz/incoming', async (req, res) => {
  const agentId = req.query.agentId || 'default';
  console.log(`[Vobiz] Incoming call received, routing to agent: ${agentId}`);
  
  const host = req.headers.host;
  const protocol = req.headers['x-forwarded-proto'] === 'https' ? 'wss' : 'ws';
  
  res.type('text/xml');
  res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Speak voice="WOMAN" language="en-US">Connecting you to Aura Voice assistant...</Speak>
  <Stream bidirectional="true" keepCallAlive="true" contentType="audio/x-l16;rate=8000">${protocol}://${host}/vobiz-stream/${agentId}</Stream>
</Response>`);
});

// Basic Health Check Route
app.get('/health', (req, res) => {
  res.json({ status: 'healthy', timestamp: new Date() });
});

// WebSocket connection routing logic
server.on('upgrade', (request, socket, head) => {
  const url = new URL(request.url, `http://${request.headers.host}`);
  const pathname = url.pathname;

  if (pathname === '/media-stream' || pathname === '/webRTC-stream' || pathname.startsWith('/vobiz-stream')) {
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  } else {
    socket.destroy();
  }
});

// Handle WebSocket streams
wss.on('connection', async (ws, request) => {
  const url = new URL(request.url, `http://${request.headers.host}`);
  const pathname = url.pathname;
  let agentId = url.searchParams.get('agentId');
  if (!agentId && pathname.startsWith('/vobiz-stream/')) {
    agentId = pathname.split('/').pop();
  }
  
  console.log(`[WebSocket] Connected: Path=${pathname}, AgentId=${agentId}`);

  let agentConfig = {
    name: 'Aura Assistant',
    language: 'en',
    system_prompt: 'You are a helpful voice assistant. Be concise and conversational.',
    voice_id: 'models/gemini-3.1-flash-live-preview'
  };

  // Fetch Agent settings from Supabase if available
  if (supabase && agentId && agentId !== 'default' && agentId !== 'new') {
    try {
      const { data, error } = await supabase
        .from('agents')
        .select('*')
        .eq('id', agentId)
        .single();
      
      if (data && !error) {
        agentConfig = data;
        console.log(`[Supabase] Loaded agent config: ${agentConfig.name}`);
      } else {
        console.error(`[Supabase] Agent config error: ${error?.message || 'Agent not found'}`);
      }
    } catch (err) {
      console.error('[Supabase] Failed to fetch agent from DB:', err);
    }
  }

  // Define API keys and endpoints
  const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
  if (!GEMINI_API_KEY) {
    console.error('[Gemini] Error: GEMINI_API_KEY environment variable is not defined.');
    ws.close(1011, 'Missing Gemini API Key');
    return;
  }

  // Connect to Gemini Multimodal Live API WebSocket
  const geminiModel = 'models/gemini-3.1-flash-live-preview'; // Use the multimodal live API model
  const geminiUrl = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${GEMINI_API_KEY}`;
  
  console.log('[Gemini] Initializing bi-directional WebSocket connection...');
  const geminiWs = new WebSocket(geminiUrl);

  let streamSid = null;
  let transcript = [];
  let callStartTime = Date.now();
  let isSetupComplete = false;

  // On Gemini WS Open: Send Setup Session payload
  geminiWs.on('open', () => {
    console.log('[Gemini] Connected to Live API endpoint.');
    
    const setupMessage = {
      setup: {
        model: geminiModel,
        generationConfig: {
          responseModalities: ["AUDIO"],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: {
                voiceName: "Aoede" // Supported voices: Aoede, Charon, Fenrir, Kore, Puck
              }
            }
          }
        },
        systemInstruction: {
          parts: [
            {
              text: agentConfig.system_prompt || agentConfig.systemPrompt || 'You are Aura, an ultra-low latency voice agent.'
            }
          ]
        },
        inputAudioTranscription: {},
        outputAudioTranscription: {}
      }
    };
    
    geminiWs.send(JSON.stringify(setupMessage));
    console.log('[Gemini] Sent session configuration payload with transcriptions enabled.');
  });

  // Handle message response from Gemini (audio data out)
  geminiWs.on('message', (messageData) => {
    try {
      const response = JSON.parse(messageData.toString());
      
      // Capture live transcription segments from Gemini
      if (response.serverContent?.inputTranscription?.text) {
        const userText = response.serverContent.inputTranscription.text;
        console.log(`[Gemini Transcript Input]: ${userText}`);
        transcript.push({ role: 'user', text: userText, timestamp: new Date() });
      }

      if (response.serverContent?.outputTranscription?.text) {
        const agentText = response.serverContent.outputTranscription.text;
        console.log(`[Gemini Transcript Output]: ${agentText}`);
        
        const lastEntry = transcript[transcript.length - 1];
        if (lastEntry && lastEntry.role === 'agent') {
          const needsSpace = !lastEntry.text.endsWith(' ') && !agentText.startsWith(' ');
          lastEntry.text += (needsSpace ? ' ' : '') + agentText;
        } else {
          transcript.push({ role: 'agent', text: agentText, timestamp: new Date() });
        }
      }

      if (response.setupComplete) {
        isSetupComplete = true;
        console.log('[Gemini] setupComplete received successfully. Now ready to receive audio.');
        
        // Trigger initial greeting from Gemini to kickstart the conversation
        const greetMessage = {
          clientContent: {
            turns: [
              {
                role: "user",
                parts: [{ text: "Hello! Please introduce yourself briefly and ask how you can help me today." }]
              }
            ],
            turnComplete: true
          }
        };
        geminiWs.send(JSON.stringify(greetMessage));
        console.log('[Gemini] Sent initial greeting trigger.');
      }
      
      if (response.error) {
        console.error('[Gemini] Error response received from API:', JSON.stringify(response.error, null, 2));
      }
      
      // Handle server content chunks (Audio output)
      if (response.serverContent && response.serverContent.modelTurn) {
        const parts = response.serverContent.modelTurn.parts || [];
        for (const part of parts) {
          if (part.inlineData && part.inlineData.data) {
            const base64Audio = part.inlineData.data;

            if (pathname === '/media-stream' && streamSid) {
              // Twilio needs 8kHz mu-law — downsample Gemini's 24kHz PCM
              const pcm24Buffer = Buffer.from(base64Audio, 'base64');
              const mulawBuffer = pcm24ToMulaw(pcm24Buffer);
              const twilioResponse = {
                event: 'media',
                streamSid: streamSid,
                media: { payload: mulawBuffer.toString('base64') }
              };
              ws.send(JSON.stringify(twilioResponse));
            } else if (pathname.startsWith('/vobiz-stream')) {
              // Vobiz needs 8kHz linear PCM (little-endian) — downsample Gemini's 24kHz PCM
              const pcm24Buffer = Buffer.from(base64Audio, 'base64');
              const pcm8Buffer = pcm24ToPcm8(pcm24Buffer);
              const vobizResponse = {
                event: 'playAudio',
                streamId: streamSid,
                media: {
                  contentType: 'audio/x-l16',
                  sampleRate: 8000,
                  payload: pcm8Buffer.toString('base64')
                }
              };
              ws.send(JSON.stringify(vobizResponse));
            } else if (pathname === '/webRTC-stream') {
              // Browser WebRTC: send raw Gemini 24kHz PCM — browser plays it natively
              ws.send(JSON.stringify({
                event: 'audio',
                sampleRate: 24000,
                payload: base64Audio
              }));
            }
          }
          
          if (part.text) {
            console.log(`[Gemini Response Part Text]: ${part.text}`);
            transcript.push({ role: 'agent', text: part.text, timestamp: new Date() });
          }
        }
      }
    } catch (err) {
      console.error('[Gemini] Error parsing WebSocket message:', err);
    }
  });

  geminiWs.on('close', (code, reason) => {
    console.log(`[Gemini] Connection closed: Code=${code}, Reason=${reason.toString()}`);
    if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
      ws.close(1011, `Gemini disconnected: ${reason.toString() || 'unknown reason'}`);
    }
  });

  geminiWs.on('error', (err) => {
    console.error('[Gemini] WebSocket client error:', err);
    if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
      ws.close(1011, `Gemini API error: ${err.message || 'unknown'}`);
    }
  });

  // Handle incoming WebSocket messages from Client (Twilio or Browser WebRTC)
  ws.on('message', async (messageData) => {
    try {
      console.log(`[WebSocket] Message received on path ${pathname}:`, messageData.toString().substring(0, 150));
      if (pathname === '/media-stream' || pathname.startsWith('/vobiz-stream')) {
        const msg = JSON.parse(messageData.toString());
        
        if (!global.loggedConditionSampleCount || global.loggedConditionSampleCount < 5) {
          global.loggedConditionSampleCount = (global.loggedConditionSampleCount || 0) + 1;
          console.log(`[DEBUG] msg.event: "${msg.event}", geminiWs.readyState: ${geminiWs?.readyState}, WebSocket.OPEN: ${WebSocket.OPEN}`);
        }
        
        if (msg.event === 'start') {
          streamSid = msg.start?.streamSid || msg.start?.streamId || 'vobiz-stream';
          global.vobizStartPayload = msg;
          console.log(`[Telephony] Call Media Stream Started. Payload:`, JSON.stringify(msg, null, 2));
        } else if (msg.event === 'media' && geminiWs.readyState === WebSocket.OPEN) {
          if (!streamSid && msg.streamId) {
            streamSid = msg.streamId;
          }
          if (!isSetupComplete) {
            // Drop packets received before setup is completed to prevent Gemini errors
            return;
          }
          const payload = msg.media?.payload;
          if (!payload) {
            console.warn('[WebSocket] Warning: Media event received but payload is missing. msg.media:', msg.media);
            return;
          }
          if (!global.loggedMediaSample) {
            global.loggedMediaSample = true;
            console.log('[WebSocket] First Media Message keys:', Object.keys(msg.media), 'payload length:', payload.length);
            console.log('[WebSocket] Associated Start Payload was:', JSON.stringify(global.vobizStartPayload || { error: 'No start payload captured' }, null, 2));
          }
          
          let base64Pcm;
          if (pathname.startsWith('/vobiz-stream')) {
            const pcm8Buffer = Buffer.from(payload, 'base64');
            // Upsample telephony 8kHz linear PCM (big-endian) to 16kHz linear PCM for Gemini API
            const pcm16Buffer = pcm8ToPcm16(pcm8Buffer);
            base64Pcm = pcm16Buffer.toString('base64');
          } else {
            // For Twilio:
            const mulawBuffer = Buffer.from(payload, 'base64');
            // Upsample telephony 8kHz mu-law to 16kHz linear PCM for Gemini API
            const pcm16Buffer = mulawToPcm16(mulawBuffer);
            base64Pcm = pcm16Buffer.toString('base64');
          }
          
          // Forward audio chunk to Gemini Realtime API
          const mediaChunk = {
            realtimeInput: {
              audio: {
                mimeType: "audio/pcm;rate=16000",
                data: base64Pcm
              }
            }
          };
          geminiWs.send(JSON.stringify(mediaChunk));
        } else if (msg.event === 'stop') {
          console.log(`[Telephony] Call Media Stream Stopped. Sid: ${streamSid}`);
          ws.close();
        }
      } else if (pathname === '/webRTC-stream') {
        const msg = JSON.parse(messageData.toString());
        
        if (msg.event === 'audio' && geminiWs.readyState === WebSocket.OPEN && isSetupComplete) {
          // Browser sends raw Int16 PCM at 16kHz — forward directly to Gemini, no mulaw conversion
          const mediaChunk = {
            realtimeInput: {
              audio: {
                mimeType: "audio/pcm;rate=16000",
                data: msg.payload
              }
            }
          };
          geminiWs.send(JSON.stringify(mediaChunk));
        } else if (msg.event === 'text' && geminiWs.readyState === WebSocket.OPEN) {
          // Store user spoken transcript if client performs speech-to-text
          transcript.push({ role: 'user', text: msg.text, timestamp: new Date() });
        }
      }
    } catch (err) {
      console.error('[WebSocket] Client message handling error:', err);
    }
  });

  // Clean up and save metrics to DB when connection closes
  ws.on('close', async () => {
    console.log(`[WebSocket] Closed: Path=${pathname}`);
    
    // Close connection with Gemini
    if (geminiWs.readyState === WebSocket.OPEN || geminiWs.readyState === WebSocket.CONNECTING) {
      geminiWs.close();
    }
    
    const callDuration = Math.round((Date.now() - callStartTime) / 1000);
    
    // Auto-save call logs and transcripts in Supabase
    if (supabase && agentId && agentId !== 'default' && agentId !== 'new') {
      try {
        console.log(`[Supabase] Writing call log payload to database (Duration: ${callDuration}s)...`);
        
        const transcriptString = transcript.map(t => `[${t.role.toUpperCase()}]: ${t.text}`).join('\n') || 'No voice transcripts captured.';
        
        const { error } = await supabase
          .from('call_logs')
          .insert({
            organization_id: agentConfig.organization_id,
            agent_id: agentConfig.id,
            from_phone_number: pathname === '/media-stream' ? 'Twilio SIP' : (pathname === '/vobiz-stream' ? 'Vobiz VoiceXML' : 'WebRTC Widget Client'),
            to_phone_number: agentConfig.name,
            duration_seconds: callDuration,
            status: 'completed',
            transcript: transcriptString,
            cost: Number((callDuration * 0.005).toFixed(4)) // Mocking $0.005 per second of LLM + audio synthesis
          });
          
        if (error) {
          console.error('[Supabase] Error writing call log:', error.message);
        } else {
          console.log('[Supabase] Call log transaction written successfully.');
          
          // Increment organization's usage metrics in the database
          const { error: usageErr } = await supabase
            .from('usage_records')
            .insert({
              organization_id: agentConfig.organization_id,
              metric: 'call_minutes',
              amount: Math.ceil(callDuration / 60)
            });
            
          if (usageErr) {
            console.error('[Supabase] Error incrementing usage:', usageErr.message);
          }
        }
      } catch (err) {
        console.error('[Supabase] DB logging crash:', err);
      }
    }
  });
});

// Run server
server.listen(PORT, () => {
  console.log(`===========================================================`);
  console.log(` AuraVoice.AI Voice Gateway Server running on port ${PORT}`);
  console.log(` WebRTC Stream Path: ws://localhost:${PORT}/webRTC-stream`);
  console.log(` Twilio Stream Path: ws://localhost:${PORT}/media-stream`);
  console.log(`===========================================================`);
});
