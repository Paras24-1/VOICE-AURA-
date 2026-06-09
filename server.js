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

// Active campaigns map to track running dialing loops
const activeCampaigns = new Map();

// Vobiz Outbound dialer integration
async function initiateVobizCall(contact, agentId) {
  const authId = process.env.VOBIZ_AUTH_ID;
  const authToken = process.env.VOBIZ_AUTH_TOKEN;
  const callerId = process.env.VOBIZ_CALLER_ID;
  const host = process.env.PUBLIC_URL || process.env.NEXT_PUBLIC_APP_URL || 'https://voice-aura-production.up.railway.app';
  const answerUrl = `${host}/api/vobiz/outbound-answer?contactId=${contact.id}&agentId=${agentId}`;

  if (!authId || !authToken || !callerId) {
    console.log(`[Vobiz] Missing credentials (VOBIZ_AUTH_ID, VOBIZ_AUTH_TOKEN, or VOBIZ_CALLER_ID). Simulating call to ${contact.phone_number}`);
    return { simulated: true };
  }

  const vobizUrl = `https://api.vobiz.ai/api/v1/Account/${authId}/Call/`;

  let targetPhone = contact.phone_number || "";
  let targetName = contact.name || "";

  // Auto-recovery swap: if phone number is not valid (no digits) but name has digits, swap them
  const phoneDigits = targetPhone.replace(/[^\d]/g, "");
  const nameDigits = targetName.replace(/[^\d]/g, "");
  if (phoneDigits.length < 7 && nameDigits.length >= 7) {
    console.log(`[Vobiz] Auto-recovery: Swapping fields for contact ${contact.id}. (Phone was: "${targetPhone}", Name was: "${targetName}")`);
    targetPhone = contact.name;
    targetName = contact.phone_number;
  }

  // Clean phone numbers: remove spaces, dashes, parentheses, keep digits and leading '+'
  const cleanedTo = targetPhone.replace(/[^\d+]/g, '');
  const cleanedFrom = callerId.replace(/[^\d+]/g, '');

  console.log(`[Vobiz] Placing outbound call: from=${cleanedFrom}, to=${cleanedTo} (Contact Name: ${targetName})`);

  const response = await fetch(vobizUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Auth-ID': authId,
      'X-Auth-Token': authToken
    },
    body: JSON.stringify({
      from: cleanedFrom,
      to: cleanedTo,
      answer_url: answerUrl,
      answer_method: 'POST'
    })
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Vobiz API returned ${response.status}: ${errText}`);
  }

  const data = await response.json();
  return { simulated: false, callSid: data.call_sid || data.id || data.CallUUID || data.call_uuid };
}

// Campaign Background Queue Processor
async function runCampaignQueue(campaignId) {
  if (activeCampaigns.has(campaignId)) {
    console.log(`[Campaign] Loop already running for campaign ${campaignId}`);
    return;
  }
  
  activeCampaigns.set(campaignId, true);
  console.log(`[Campaign] Started queue loop for campaign ${campaignId}`);

  try {
    while (activeCampaigns.get(campaignId) === true) {
      const { data: campaign, error: campErr } = await supabase
        .from('campaigns')
        .select('*')
        .eq('id', campaignId)
        .single();

      if (campErr || !campaign || campaign.status !== 'running') {
        console.log(`[Campaign] Campaign ${campaignId} status is ${campaign?.status || 'not found'}. Stopping loop.`);
        break;
      }

      const { data: contact, error: contactErr } = await supabase
        .from('campaign_contacts')
        .select('*')
        .eq('campaign_id', campaignId)
        .eq('status', 'pending')
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle();

      if (contactErr) {
        console.error('[Campaign] Error fetching next contact:', contactErr);
        await new Promise(resolve => setTimeout(resolve, 5000));
        continue;
      }

      if (!contact) {
        console.log(`[Campaign] No more pending contacts for campaign ${campaignId}. Marking completed.`);
        await supabase
          .from('campaigns')
          .update({ status: 'completed' })
          .eq('id', campaignId);
        break;
      }

      console.log(`[Campaign] Dialing contact: ${contact.name} (${contact.phone_number})`);

      await supabase
        .from('campaign_contacts')
        .update({ status: 'dialing' })
        .eq('id', contact.id);

      try {
        const result = await initiateVobizCall(contact, campaign.agent_id);

        if (result.simulated) {
          console.log(`[Campaign] Simulated dial started for ${contact.name}. Waiting for answer/simulation.`);
          let answered = false;
          
          for (let i = 0; i < 10; i++) {
            await new Promise(resolve => setTimeout(resolve, 1000));
            if (activeCampaigns.get(campaignId) !== true) break;

            const { data: updatedContact } = await supabase
              .from('campaign_contacts')
              .select('status')
              .eq('id', contact.id)
              .single();

            if (updatedContact && (updatedContact.status === 'answered' || updatedContact.status === 'completed')) {
              answered = true;
              break;
            }
          }

          if (answered) {
            console.log(`[Campaign] Simulated call answered/active. Waiting for completion...`);
            while (activeCampaigns.get(campaignId) === true) {
              const { data: updatedContact } = await supabase
                .from('campaign_contacts')
                .select('status')
                .eq('id', contact.id)
                .single();

              if (updatedContact && updatedContact.status === 'completed') {
                break;
              }
              await new Promise(resolve => setTimeout(resolve, 1000));
            }
          } else {
            console.log(`[Campaign] No interactive connection. Auto-simulating completed call.`);
            const mockDuration = Math.floor(Math.random() * 20) + 10;
            
            await supabase
              .from('campaign_contacts')
              .update({
                status: 'completed',
                duration_seconds: mockDuration,
                call_sid: 'mock-call-sid-' + Math.random().toString(36).substring(7)
              })
              .eq('id', contact.id);

            await supabase
              .from('call_logs')
              .insert({
                organization_id: campaign.organization_id,
                agent_id: campaign.agent_id,
                from_phone_number: 'Campaign Auto-Dialer (Mock)',
                to_phone_number: `${contact.name} (${contact.phone_number})`,
                duration_seconds: mockDuration,
                status: 'completed',
                transcript: `[AGENT]: Hello ${contact.name}! I am calling to follow up on your request. How are you today?\n[USER]: Hi, I am doing well, thank you for calling.\n[AGENT]: Great to hear! Let me know if you need any assistance. Have a nice day!`,
                cost: Number((mockDuration * 0.005).toFixed(4))
              });
          }
        } else {
          await supabase
            .from('campaign_contacts')
            .update({ call_sid: result.callSid })
            .eq('id', contact.id);

          console.log(`[Campaign] Real call initiated. SID: ${result.callSid}. Waiting for completion.`);
          let callActive = true;
          while (callActive && activeCampaigns.get(campaignId) === true) {
            await new Promise(resolve => setTimeout(resolve, 2000));
            const { data: updatedContact } = await supabase
              .from('campaign_contacts')
              .select('status')
              .eq('id', contact.id)
              .single();

            if (updatedContact && ['completed', 'failed', 'busy', 'no-answer'].includes(updatedContact.status)) {
              callActive = false;
            }
          }
        }
      } catch (dialErr) {
        console.error(`[Campaign] Failed to dial ${contact.name}:`, dialErr);
        await supabase
          .from('campaign_contacts')
          .update({ status: 'failed' })
          .eq('id', contact.id);
      }

      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  } catch (err) {
    console.error(`[Campaign] Error in campaign queue loop for ${campaignId}:`, err);
  } finally {
    activeCampaigns.delete(campaignId);
    console.log(`[Campaign] Finished queue loop for campaign ${campaignId}`);
  }
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
  <Say voice="alice" language="en-US">Connecting you to Vox AI...</Say>
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
  <Speak voice="WOMAN" language="en-US">Connecting you to Vox AI...</Speak>
  <Stream bidirectional="true" keepCallAlive="true" contentType="audio/x-l16;rate=8000">${protocol}://${host}/vobiz-stream/${agentId}</Stream>
</Response>`);
});

// Basic Health Check Route
app.get('/health', (req, res) => {
  res.json({ status: 'healthy', timestamp: new Date() });
});

// Vobiz Outbound Answer webhook
app.post('/api/vobiz/outbound-answer', async (req, res) => {
  const { contactId, agentId } = req.query;
  console.log(`[Vobiz Webhook] Outbound call answered for contactId=${contactId}, agentId=${agentId}`);

  if (supabase && contactId) {
    try {
      await supabase
        .from('campaign_contacts')
        .update({ status: 'answered' })
        .eq('id', contactId);
    } catch (err) {
      console.error('[Vobiz Webhook] Error updating status:', err);
    }
  }

  const host = req.headers.host;
  const protocol = req.headers['x-forwarded-proto'] === 'https' ? 'wss' : 'ws';

  res.type('text/xml');
  res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Speak voice="WOMAN" language="en-US">Connecting you to Vox AI...</Speak>
  <Stream bidirectional="true" keepCallAlive="true" contentType="audio/x-l16;rate=8000">${protocol}://${host}/vobiz-stream/${agentId}/${contactId}</Stream>
</Response>`);
});

// Vobiz Events webhook
app.post('/api/vobiz/events', async (req, res) => {
  const { contactId } = req.query;
  const { event, status } = req.body;
  console.log(`[Vobiz Event] Call event: contactId=${contactId}, event=${event}, status=${status}`);

  if (supabase && contactId) {
    try {
      let contactStatus = 'pending';
      if (status === 'busy') contactStatus = 'busy';
      else if (status === 'no-answer') contactStatus = 'no-answer';
      else if (status === 'failed') contactStatus = 'failed';
      else if (status === 'completed') contactStatus = 'completed';

      if (contactStatus !== 'pending') {
        await supabase
          .from('campaign_contacts')
          .update({ status: contactStatus })
          .eq('id', contactId);
      }
    } catch (err) {
      console.error('[Vobiz Event] Error updating status:', err);
    }
  }

  res.status(200).send('OK');
});

// Start campaign API
app.post('/api/campaigns/start', async (req, res) => {
  const { campaignId } = req.body;
  if (!campaignId) {
    return res.status(400).json({ error: 'Missing campaignId' });
  }

  if (!supabase) {
    return res.status(500).json({ error: 'Supabase client not initialized' });
  }

  try {
    const { data: campaign, error } = await supabase
      .from('campaigns')
      .update({ status: 'running' })
      .eq('id', campaignId)
      .select()
      .single();

    if (error || !campaign) {
      return res.status(404).json({ error: 'Campaign not found or failed to update' });
    }

    runCampaignQueue(campaignId);

    return res.json({ success: true, campaign });
  } catch (err) {
    console.error('[Campaign API] Error starting campaign:', err);
    return res.status(500).json({ error: err.message });
  }
});

// Pause campaign API
app.post('/api/campaigns/pause', async (req, res) => {
  const { campaignId } = req.body;
  if (!campaignId) {
    return res.status(400).json({ error: 'Missing campaignId' });
  }

  if (!supabase) {
    return res.status(500).json({ error: 'Supabase client not initialized' });
  }

  try {
    const { data: campaign, error } = await supabase
      .from('campaigns')
      .update({ status: 'paused' })
      .eq('id', campaignId)
      .select()
      .single();

    if (error || !campaign) {
      return res.status(404).json({ error: 'Campaign not found or failed to update' });
    }

    activeCampaigns.set(campaignId, false);

    return res.json({ success: true, campaign });
  } catch (err) {
    console.error('[Campaign API] Error pausing campaign:', err);
    return res.status(500).json({ error: err.message });
  }
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
  let contactId = url.searchParams.get('contactId');

  // Handle path-based routing for Vobiz streams (e.g. /vobiz-stream/agentId/contactId)
  if (pathname.startsWith('/vobiz-stream/')) {
    const segments = pathname.split('/').filter(Boolean); // e.g. ['vobiz-stream', 'agent-uuid', 'contact-uuid']
    if (segments.length >= 2) {
      agentId = segments[1];
    }
    if (segments.length >= 3) {
      contactId = segments[2];
    }
  }
  
  console.log(`[WebSocket] Connected: Path=${pathname}, AgentId=${agentId}, ContactId=${contactId}`);

  let agentConfig = {
    name: 'Vox Assistant',
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
  let isGreetingSent = false;

  const triggerGreeting = () => {
    if (isGreetingSent) return;
    if (isSetupComplete && streamSid) {
      isGreetingSent = true;
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
      console.log(`[Gemini] Sent initial greeting trigger for stream: ${streamSid}`);
    }
  };

  // Mark contact as answered when socket connects (meaning webhook answered or browser simulator started)
  if (supabase && contactId) {
    try {
      console.log(`[Campaign] Marking contact ${contactId} as answered`);
      await supabase
        .from('campaign_contacts')
        .update({ status: 'answered' })
        .eq('id', contactId);
    } catch (err) {
      console.error('[Campaign] Error updating contact answered status:', err);
    }
  }

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
              text: agentConfig.system_prompt || agentConfig.systemPrompt || 'You are Vox, an ultra-low latency voice agent.'
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
        triggerGreeting();
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
          triggerGreeting();
        } else if (msg.event === 'media' && geminiWs.readyState === WebSocket.OPEN) {
          if (!streamSid && msg.streamId) {
            streamSid = msg.streamId;
            triggerGreeting();
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
        
        let fromPhone = pathname === '/media-stream' ? 'Twilio SIP' : (pathname.startsWith('/vobiz-stream') ? 'Vobiz VoiceXML' : 'WebRTC Widget Client');
        if (contactId) {
          fromPhone = pathname.startsWith('/vobiz-stream') ? 'Vobiz Outbound' : 'WebRTC Outbound Simulator';
        }

        const { error } = await supabase
          .from('call_logs')
          .insert({
            organization_id: agentConfig.organization_id,
            agent_id: agentConfig.id,
            from_phone_number: fromPhone,
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

        // Update campaign contact status to completed if this was a campaign call
        if (contactId) {
          console.log(`[Campaign] Updating contact ${contactId} status to completed`);
          const { error: updateErr } = await supabase
            .from('campaign_contacts')
            .update({
              status: 'completed',
              duration_seconds: callDuration,
              call_sid: streamSid || 'simulated-sid'
            })
            .eq('id', contactId);

          if (updateErr) {
            console.error('[Campaign] Error updating campaign contact:', updateErr.message);
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
