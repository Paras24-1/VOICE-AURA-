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
const activeCallContexts = new Map(); // Map to store call-specific lead context (e.g. from n8n)

// Helper to process system prompt templates for inbound vs outbound calls
function processSystemPrompt(systemPromptText, leadContext) {
  if (leadContext && Object.keys(leadContext).length > 0) {
    let processedPrompt = systemPromptText;
    for (const [key, value] of Object.entries(leadContext)) {
      const regex = new RegExp(`\\{\\{\\s*${key}\\s*\\}\\}`, 'gi');
      processedPrompt = processedPrompt.replace(regex, value || '');
    }
    processedPrompt = processedPrompt.replace(/\{\{\s*lead_name\s*\}\}/gi, 'सर/मैम');
    processedPrompt = processedPrompt.replace(/\{\{\s*assigned_employee_name\s*\}\}/gi, 'हमारे सेल्स प्रतिनिधि');
    processedPrompt = processedPrompt.replace(/\{\{\s*machine_interest\s*\}\}/gi, 'मशीन');
    processedPrompt = processedPrompt.replace(/\{\{\s*budget\s*\}\}/gi, 'बजट');
    processedPrompt = processedPrompt.replace(/\{\{\s*([a-zA-Z0-9_-]+)\s*\}\}/g, '');
    return processedPrompt;
  } else {
    let processedPrompt = systemPromptText;
    
    // Inbound call - replace language-specific parts with grammatically correct fallbacks
    processedPrompt = processedPrompt.replace(
      /मी तुमची call आत्ता \{\{\s*assigned_employee_name\s*\}\} कडे transfer करू का\?/g,
      "मी तुमची call आत्ता आमच्या सेल्स एक्सपर्ट कडे transfer करू का?"
    );
    processedPrompt = processedPrompt.replace(
      /transfer your call to \{\{\s*assigned_employee_name\s*\}\} from our sales team/gi,
      "transfer your call to a sales representative from our team"
    );
    
    const openingRegex = /CALL OPENING[\s\S]*?CONVERSATION FLOW:/i;
    if (openingRegex.test(processedPrompt)) {
      const inboundOpening = `CALL OPENING (use this EXACTLY on call connect):

Hindi:
"नमस्ते! Shree Mahalaxmi Enterprises, Pune में आपका स्वागत है। मैं आपकी क्या सहायता कर सकता/सकती हूँ?"

Marathi:
"नमस्ते! श्री महालक्ष्मी एंटरप्राइजेस, पुणे मध्ये आपले स्वागत आहे. मी आपली काय मदत करू शकतो/शकते?"

English:
"Hello! Welcome to Shree Mahalaxmi Enterprises, Pune. How can I help you today?"


CONVERSATION FLOW:`;
      processedPrompt = processedPrompt.replace(openingRegex, inboundOpening);
    }
    processedPrompt = processedPrompt.replace(/\{\{\s*lead_name\s*\}\}/gi, 'सर/मैम');
    processedPrompt = processedPrompt.replace(/\{\{\s*assigned_employee_name\s*\}\}/gi, 'हमारे सेल्स प्रतिनिधि');
    processedPrompt = processedPrompt.replace(/\{\{\s*machine_interest\s*\}\}/gi, 'मशीन');
    processedPrompt = processedPrompt.replace(/\{\{\s*budget\s*\}\}/gi, 'बजट');
    processedPrompt = processedPrompt.replace(/\{\{\s*([a-zA-Z0-9_-]+)\s*\}\}/g, '');
    return processedPrompt;
  }
}

// Vobiz Outbound dialer integration
async function initiateVobizCall(contact, agentId) {
  const authId = process.env.VOBIZ_AUTH_ID;
  const authToken = process.env.VOBIZ_AUTH_TOKEN;
  const host = process.env.PUBLIC_URL || process.env.NEXT_PUBLIC_APP_URL || 'https://voice-aura-production.up.railway.app';
  const answerUrl = `${host}/api/vobiz/outbound-answer?agentId=${agentId}${contact.id ? `&contactId=${contact.id}` : ''}`;

  let callerId = process.env.VOBIZ_CALLER_ID;

  // Fetch agent's custom telephone number from database to act as the dynamic callerId
  if (supabase && agentId && agentId !== 'default' && agentId !== 'new') {
    try {
      const { data, error } = await supabase
        .from('agents')
        .select('telephone_number')
        .eq('id', agentId)
        .single();
        
      if (data && data.telephone_number) {
        callerId = data.telephone_number;
        console.log(`[Vobiz] Using agent-specific caller ID: ${callerId} for agent ${agentId}`);
      }
    } catch (dbErr) {
      console.error('[Vobiz] Error fetching agent caller ID from Supabase:', dbErr);
    }
  }

  if (!authId || !authToken || !callerId) {
    console.log(`[Vobiz] Missing credentials (VOBIZ_AUTH_ID, VOBIZ_AUTH_TOKEN, or callerId). Simulating call to ${contact.phone_number}`);
    return { simulated: true };
  }

  const vobizUrl = `https://api.vobiz.ai/api/v1/Account/${authId}/Call/`;

  let targetPhone = contact.phone_number || "";
  let targetName = contact.name || "";

  // Auto-recovery swap: if phone number is not valid (no digits) but name has digits, swap them
  const phoneDigits = targetPhone.replace(/[^\d]/g, "");
  const nameDigits = targetName.replace(/[^\d]/g, "");
  if (phoneDigits.length < 7 && nameDigits.length >= 7) {
    console.log(`[Vobiz] Auto-recovery: Swapping fields for contact ${contact.id || 'direct'}. (Phone was: "${targetPhone}", Name was: "${targetName}")`);
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

            // Fetch previous calls for billing calculations
            let prevTotalSeconds = 0;
            const { data: previousCalls, error: prevErr } = await supabase
              .from('call_logs')
              .select('duration_seconds')
              .eq('organization_id', campaign.organization_id);
              
            if (!prevErr && previousCalls) {
              prevTotalSeconds = previousCalls.reduce((sum, c) => sum + (c.duration_seconds || 0), 0);
            }

            const FREE_SECONDS_LIMIT = 600 * 60; // 600 minutes
            const RATE_PER_MINUTE = 3.5; // ₹3.5/min
            const RATE_PER_SECOND = RATE_PER_MINUTE / 60;
            
            let calculatedCost = 0;
            const newTotalSeconds = prevTotalSeconds + mockDuration;
            
            if (prevTotalSeconds >= FREE_SECONDS_LIMIT) {
              calculatedCost = mockDuration * RATE_PER_SECOND;
            } else if (newTotalSeconds > FREE_SECONDS_LIMIT) {
              const billableSeconds = newTotalSeconds - FREE_SECONDS_LIMIT;
              calculatedCost = billableSeconds * RATE_PER_SECOND;
            } else {
              calculatedCost = 0;
            }
            const finalCost = Number(calculatedCost.toFixed(4));

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
                cost: finalCost
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
  const callUuid = req.body.CallUUID || req.body.call_uuid || req.body.CallSid || req.body.call_sid || req.query.CallUUID || req.query.call_uuid || '';
  console.log(`[Vobiz] Incoming call received, routing to agent: ${agentId}, CallUUID: ${callUuid}`);
  
  const host = req.headers.host;
  const protocol = req.headers['x-forwarded-proto'] === 'https' ? 'wss' : 'ws';
  
  res.type('text/xml');
  res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Speak voice="WOMAN" language="en-US">Connecting you to Vox AI...</Speak>
  <Stream bidirectional="true" keepCallAlive="true" contentType="audio/x-l16;rate=8000">${protocol}://${host}/vobiz-stream/${agentId}?callUuid=${callUuid}</Stream>
</Response>`);
});

// Basic Health Check Route
app.get('/health', (req, res) => {
  res.json({ status: 'healthy', timestamp: new Date() });
});

// Vobiz Outbound Answer webhook
app.post('/api/vobiz/outbound-answer', async (req, res) => {
  const { contactId, agentId } = req.query;
  const callUuid = req.body.CallUUID || req.body.call_uuid || req.body.CallSid || req.body.call_sid || req.query.call_uuid || req.query.CallUUID || '';
  console.log(`[Vobiz Webhook] Outbound call answered for contactId=${contactId}, agentId=${agentId}, CallUUID=${callUuid}`);

  if (supabase && contactId && contactId !== 'direct') {
    try {
      await supabase
        .from('campaign_contacts')
        .update({ status: 'answered', call_sid: callUuid })
        .eq('id', contactId);
    } catch (err) {
      console.error('[Vobiz Webhook] Error updating status:', err);
    }
  }

  const host = req.headers.host;
  const protocol = req.headers['x-forwarded-proto'] === 'https' ? 'wss' : 'ws';

  // Check if we have context stored for this callUuid to append it to the websocket URL
  const contextData = activeCallContexts.get(callUuid);
  let streamUrl = `${protocol}://${host}/vobiz-stream/${agentId}/${contactId || 'direct'}?callUuid=${callUuid}`;
  if (contextData) {
    streamUrl += `&context=${encodeURIComponent(JSON.stringify(contextData))}`;
  }

  res.type('text/xml');
  res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Speak voice="WOMAN" language="en-US">Connecting you to Vox AI...</Speak>
  <Stream bidirectional="true" keepCallAlive="true" contentType="audio/x-l16;rate=8000">${streamUrl}</Stream>
</Response>`);
});

// Vobiz Transfer Callback webhook
app.post('/api/vobiz/transfer-callback', async (req, res) => {
  const targetNumber = req.query.targetNumber || process.env.DEFAULT_HANDOVER_NUMBER || '+15555555555';
  const callerId = req.query.callerId || process.env.VOBIZ_CALLER_ID || '';
  console.log(`[Vobiz Transfer Webhook] Transferring call to: ${targetNumber}, callerId: ${callerId}`);
  const host = req.headers.host;
  const protocol = req.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http';
  
  // Set the action callback URL to events so we receive the Dial duration upon completion
  const actionUrl = `${protocol}://${host}/api/vobiz/events?action=dial-ended`;
  
  res.type('text/xml');
  res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Speak voice="WOMAN" language="en-US">Please hold while I connect you to a human agent...</Speak>
  <Dial action="${actionUrl}" confirmKey="1" confirmSound="${protocol}://${host}/api/vobiz/whisper" callerId="${callerId}">
    <Number>${targetNumber}</Number>
  </Dial>
</Response>`);
});

// Vobiz Whisper webhook
app.post('/api/vobiz/whisper', async (req, res) => {
  console.log(`[Vobiz Whisper Webhook] Playing voice whisper to human agent.`);
  
  res.type('text/xml');
  res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Speak voice="WOMAN" language="en-US">Incoming call transfer from the AI assistant. Press 1 to connect.</Speak>
</Response>`);
});


// Vobiz Events webhook (supports both GET and POST)
app.all('/api/vobiz/events', async (req, res) => {
  const { contactId } = req.query;
  const method = req.method;
  const params = method === 'GET' ? req.query : req.body;
  const event = params.event;
  const status = params.status;
  
  console.log(`[Vobiz Event] Call event (${method}): contactId=${contactId}, event=${event}, status=${status}, query:`, JSON.stringify(req.query), `body:`, JSON.stringify(req.body));

  const callUuid = params.CallUUID || params.call_uuid || params.CallSid || params.call_sid || req.query.CallUUID || req.query.call_uuid || req.query.CallSid || req.query.call_sid || '';
  const finalDuration = Number(params.Duration || params.duration || params.Billsec || params.billsec || params.BillDuration || params.bill_duration || req.query.Duration || req.query.duration || req.query.Billsec || req.query.billsec || req.query.BillDuration || req.query.bill_duration || 0);
  const dialDuration = Number(params.DialCallDuration || params.dial_call_duration || req.query.DialCallDuration || req.query.dial_call_duration || 0);

  const isDialEnded = (req.query.action === 'dial-ended');

  // If a call is completed/hung up and we have a valid duration (either total or dialed human duration), update the call log
  if (supabase && callUuid && (finalDuration > 0 || dialDuration > 0)) {
    try {
      console.log(`[Vobiz Event] Processing event for CallUUID ${callUuid}. Vobiz Total Duration: ${finalDuration}s, Dial (Human) Duration: ${dialDuration}s, isDialEnded: ${isDialEnded}`);
      
      // Fetch the call log matching call_sid
      const { data: callLog, error: fetchErr } = await supabase
        .from('call_logs')
        .select('*')
        .eq('call_sid', callUuid)
        .maybeSingle();

      if (fetchErr) {
        console.error(`[Vobiz Event] Error fetching call log for UUID ${callUuid}:`, fetchErr.message);
      } else if (callLog) {
        let newDuration = 0;
        
        if (isDialEnded) {
          // If we have a dialed human agent call duration, add it to the existing AI duration
          // (the existing duration already has the 5s padding from close handler)
          newDuration = (callLog.duration_seconds || 0) + dialDuration;
        } else {
          // If we have total call duration from Vobiz, use it (and add 5 seconds padding)
          newDuration = finalDuration + 5;
        }

        // Only update if the new calculated duration is greater than what is currently in the DB
        if (newDuration > 0 && newDuration > (callLog.duration_seconds || 0)) {
          // Fetch previous call logs to recalculate the cost accurately
          let prevTotalSeconds = 0;
          const { data: previousCalls, error: prevErr } = await supabase
            .from('call_logs')
            .select('duration_seconds')
            .eq('organization_id', callLog.organization_id)
            .neq('id', callLog.id); // exclude the current call log
            
          if (!prevErr && previousCalls) {
            prevTotalSeconds = previousCalls.reduce((sum, c) => sum + (c.duration_seconds || 0), 0);
          }

          const FREE_SECONDS_LIMIT = 600 * 60; // 600 minutes
          const RATE_PER_MINUTE = 3.5; // ₹3.5/min
          const RATE_PER_SECOND = RATE_PER_MINUTE / 60;
          
          let calculatedCost = 0;
          const newTotalSeconds = prevTotalSeconds + newDuration;
          
          if (prevTotalSeconds >= FREE_SECONDS_LIMIT) {
            calculatedCost = newDuration * RATE_PER_SECOND;
          } else if (newTotalSeconds > FREE_SECONDS_LIMIT) {
            const billableSeconds = newTotalSeconds - FREE_SECONDS_LIMIT;
            calculatedCost = billableSeconds * RATE_PER_SECOND;
          } else {
            calculatedCost = 0;
          }
          
          const finalCost = Number(calculatedCost.toFixed(4));

          console.log(`[Vobiz Event] Updating call log ${callLog.id}: New Duration: ${newDuration}s (Padded/Bridged), New Cost: ₹ ${finalCost}`);

          const { error: updateErr } = await supabase
            .from('call_logs')
            .update({
              duration_seconds: newDuration,
              cost: finalCost
            })
            .eq('id', callLog.id);

          if (updateErr) {
            console.error(`[Vobiz Event] Error updating call log ${callLog.id}:`, updateErr.message);
          } else {
            console.log(`[Vobiz Event] Call log ${callLog.id} updated successfully.`);
          }
        } else {
          console.log(`[Vobiz Event] Skipped update: newDuration (${newDuration}s) is not greater than existing duration_seconds (${callLog.duration_seconds || 0}s)`);
        }
      } else {
        console.log(`[Vobiz Event] No call log found in DB with call_sid=${callUuid}.`);
      }
    } catch (err) {
      console.error('[Vobiz Event] Exception in completed call processing:', err);
    }
  }

  if (supabase && contactId && contactId !== 'direct') {
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

// Trigger direct call endpoint (useful for n8n flow integrations)
app.post('/api/calls/trigger', async (req, res) => {
  const { phone_number, name, agentId, context } = req.body;
  if (!phone_number) {
    return res.status(400).json({ error: 'Missing phone_number in request body' });
  }
  
  const targetAgentId = agentId || 'default';
  console.log(`[Trigger Call API] Received request to dial ${phone_number} (Name: ${name || 'N/A'}) for agent: ${targetAgentId}`);

  try {
    const contact = {
      phone_number: phone_number,
      name: name || 'Direct Call Lead'
    };
    
    const result = await initiateVobizCall(contact, targetAgentId);
    
    // Store custom lead context if provided
    const callUuid = result.callSid || 'simulated';
    if (context) {
      activeCallContexts.set(callUuid, context);
      console.log(`[Trigger Call API] Stored context for CallUUID ${callUuid}:`, JSON.stringify(context));
    }

    return res.json({
      success: true,
      message: result.simulated ? 'Simulated call triggered successfully' : 'Real outbound call initiated successfully',
      callSid: callUuid,
      simulated: result.simulated
    });
  } catch (err) {
    console.error('[Trigger Call API] Error triggering call:', err);
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
  let callSid = url.searchParams.get('callSid') || url.searchParams.get('callUuid');

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
  
  console.log(`[WebSocket] Connected: Path=${pathname}, AgentId=${agentId}, ContactId=${contactId}, CallSid=${callSid}`);

  // Extract custom lead context if passed via query parameter or in-memory map
  let contextParam = url.searchParams.get('context');
  let leadContext = null;
  if (contextParam) {
    try {
      leadContext = JSON.parse(decodeURIComponent(contextParam));
    } catch (e) {
      console.error('[WebSocket] Error parsing context query param:', e);
    }
  }
  if (!leadContext && callSid) {
    leadContext = activeCallContexts.get(callSid);
  }

  // Fetch callSid from database as fallback for outbound campaign calls if not in query params
  if (!callSid && contactId && contactId !== 'direct' && supabase) {
    try {
      const { data } = await supabase
        .from('campaign_contacts')
        .select('call_sid')
        .eq('id', contactId)
        .single();
      if (data && data.call_sid) {
        callSid = data.call_sid;
        console.log(`[WebSocket] Resolved callSid ${callSid} from database for contactId=${contactId}`);
      }
    } catch (e) {
      console.error('[WebSocket] Error resolving callSid from database:', e);
    }
  }

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
      const greetingText = (leadContext && Object.keys(leadContext).length > 0)
        ? "Hello! Please initiate the outbound call by greeting the lead exactly as instructed in the CALL OPENING section."
        : "Hello! A customer has called in. Please greet them warmly using the CALL OPENING instruction for inbound calls.";
      
      const greetMessage = {
        clientContent: {
          turns: [
            {
              role: "user",
              parts: [{ text: greetingText }]
            }
          ],
          turnComplete: true
        }
      };
      geminiWs.send(JSON.stringify(greetMessage));
      console.log(`[Gemini] Sent initial greeting trigger for stream: ${streamSid} (Inbound: ${!leadContext})`);
    }
  };

  // Mark contact as answered when socket connects (meaning webhook answered or browser simulator started)
  if (supabase && contactId && contactId !== 'direct') {
    supabase
      .from('campaign_contacts')
      .update({ status: 'answered' })
      .eq('id', contactId)
      .then(({ error }) => {
        if (error) {
          console.error('[Campaign] Error updating contact answered status:', error.message);
        }
      })
      .catch((err) => {
        console.error('[Campaign] Error updating contact answered status:', err);
      });
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
        tools: [{
          functionDeclarations: [{
            name: "transferCall",
            description: "Transfer the active telephone call to a human agent/support representative when requested by the caller.",
            parameters: {
              type: "object",
              properties: {
                targetNumber: {
                  type: "string",
                  description: "The phone number to transfer the call to. By default, it will be the default support agent number if not provided."
                }
              },
              required: []
            }
          }]
        }],
        systemInstruction: {
          parts: [
            {
              text: (() => {
                let systemPromptText = agentConfig.system_prompt || agentConfig.systemPrompt || 'You are Vox, an ultra-low latency voice agent.';
                systemPromptText = processSystemPrompt(systemPromptText, leadContext);
                
                if (leadContext) {
                  console.log(`[Gemini] Appending lead context to system prompt:`, JSON.stringify(leadContext));
                  let contextStr = '\n\n--------------------------------------------------\n';
                  contextStr += '[ACTIVE CALL LEAD CONTEXT - FOR YOUR REFERENCE ONLY]\n';
                  for (const [key, value] of Object.entries(leadContext)) {
                    const formattedKey = key
                      .split('_')
                      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
                      .join(' ');
                    contextStr += `${formattedKey}: ${value}\n`;
                  }
                  contextStr += '--------------------------------------------------\n';
                  systemPromptText += contextStr;
                }
                return systemPromptText + '\n\nIf the user requests to speak to a human or transfer the call, invoke the `transferCall` tool. Suggest transferring if the user is frustrated or if their request is beyond your capabilities.';
              })()
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
  geminiWs.on('message', async (messageData) => {
    try {
      const response = JSON.parse(messageData.toString());
      
      // Handle tool calls from Gemini
      if (response.toolCall && response.toolCall.functionCalls) {
        console.log(`[Gemini ToolCall] Received function calls:`, JSON.stringify(response.toolCall.functionCalls));
        const functionResponses = [];
        
        for (const fc of response.toolCall.functionCalls) {
          if (fc.name === 'transferCall') {
            // Prioritize the agent's custom transfer number if configured, otherwise fall back to the global default.
            // This prevents LLM hallucinations of dummy numbers (e.g. 9876543210) from overriding the correct destination.
            const targetNumber = agentConfig.transfer_number || process.env.DEFAULT_HANDOVER_NUMBER || '+15555555555';
            
            console.log(`[Gemini ToolCall] Initiating call transfer. Agent transfer_number: "${agentConfig.transfer_number || ''}", Env default: "${process.env.DEFAULT_HANDOVER_NUMBER || ''}", Resolved Target: "${targetNumber}", Pathname: "${pathname}"`);
            
            let success = false;
            let errorMsg = '';
            
            try {
              if (pathname.startsWith('/vobiz-stream')) {
                const authId = process.env.VOBIZ_AUTH_ID;
                const authToken = process.env.VOBIZ_AUTH_TOKEN;
                
                if (!authId || !authToken) {
                  throw new Error('Vobiz credentials not configured');
                }
                
                if (!callSid || callSid === 'vobiz-stream') {
                  throw new Error('Valid Call UUID not available for transfer');
                }
                
                const host = process.env.PUBLIC_URL || process.env.NEXT_PUBLIC_APP_URL || 'https://voice-aura-production.up.railway.app';
                const cleanHost = host.replace(/^https?:\/\//, '');
                const protocol = request.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http';
                let redirectUrl = `${protocol}://${cleanHost}/api/vobiz/transfer-callback?targetNumber=${encodeURIComponent(targetNumber)}`;
                if (agentConfig && agentConfig.telephone_number) {
                  redirectUrl += `&callerId=${encodeURIComponent(agentConfig.telephone_number)}`;
                }
                const vobizUrl = `https://api.vobiz.ai/api/v1/Account/${authId}/Call/${callSid}/`;
                
                console.log(`[Vobiz Transfer] Updating call ${callSid} with aleg_url=${redirectUrl}`);
                
                const vobizResponse = await fetch(vobizUrl, {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                    'X-Auth-ID': authId,
                    'X-Auth-Token': authToken
                  },
                  body: JSON.stringify({
                    legs: 'aleg',
                    aleg_url: redirectUrl,
                    aleg_method: 'POST'
                  })
                });
                
                if (!vobizResponse.ok) {
                  const errText = await vobizResponse.text();
                  throw new Error(`Vobiz API returned ${vobizResponse.status}: ${errText}`);
                }
                
                console.log(`[Vobiz Transfer] Call ${callSid} redirected successfully to ${targetNumber}`);
                success = true;
              } else if (pathname === '/webRTC-stream') {
                // WebRTC Simulator transfer
                ws.send(JSON.stringify({
                  event: 'callTransferSimulated',
                  targetNumber: targetNumber
                }));
                console.log(`[WebRTC Transfer] Simulated transfer to ${targetNumber} triggered`);
                success = true;
              } else {
                throw new Error(`Unsupported stream path for transfer: ${pathname}`);
              }
            } catch (err) {
              console.error(`[Transfer Error] Failed to transfer call:`, err);
              errorMsg = err.message;
            }
            
            functionResponses.push({
              name: fc.name,
              id: fc.id,
              response: {
                output: {
                  success: success,
                  message: success ? `Call successfully transferred to ${targetNumber}` : `Failed to transfer call: ${errorMsg}`
                }
              }
            });
          }
        }
        
        // Send tool response back to Gemini
        const toolResponseMsg = {
          toolResponse: {
            functionResponses: functionResponses
          }
        };
        geminiWs.send(JSON.stringify(toolResponseMsg));
        console.log(`[Gemini ToolCall] Sent function response back to Gemini:`, JSON.stringify(toolResponseMsg));
      }
      
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
      // Commented out high-frequency logging to prevent Railway rate limits and improve network latency
      // console.log(`[WebSocket] Message received on path ${pathname}:`, messageData.toString().substring(0, 150));
      if (pathname === '/media-stream' || pathname.startsWith('/vobiz-stream')) {
        const msg = JSON.parse(messageData.toString());
        
        if (!global.loggedConditionSampleCount || global.loggedConditionSampleCount < 5) {
          global.loggedConditionSampleCount = (global.loggedConditionSampleCount || 0) + 1;
          console.log(`[DEBUG] msg.event: "${msg.event}", geminiWs.readyState: ${geminiWs?.readyState}, WebSocket.OPEN: ${WebSocket.OPEN}`);
        }
        
        if (msg.event === 'start') {
          streamSid = msg.start?.streamSid || msg.start?.streamId || msg.streamId || 'vobiz-stream';
          global.vobizStartPayload = msg;
          console.log(`[Telephony] Call Media Stream Started. Payload:`, JSON.stringify(msg, null, 2));
          triggerGreeting();
        } else if (msg.event === 'media' && geminiWs.readyState === WebSocket.OPEN) {
          if ((!streamSid || streamSid === 'vobiz-stream') && msg.streamId) {
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
    
    const callDuration = Math.round((Date.now() - callStartTime) / 1000) + 5;
    
    // Auto-save call logs and transcripts in Supabase
    if (supabase && agentId && agentId !== 'default' && agentId !== 'new') {
      try {
        console.log(`[Supabase] Writing call log payload to database (Duration: ${callDuration}s)...`);
        
        const transcriptString = transcript.map(t => `[${t.role.toUpperCase()}]: ${t.text}`).join('\n') || 'No voice transcripts captured.';
        
        let fromPhone = pathname === '/media-stream' ? 'Twilio SIP' : (pathname.startsWith('/vobiz-stream') ? 'Vobiz VoiceXML' : 'WebRTC Widget Client');
        if (contactId && contactId !== 'direct') {
          fromPhone = pathname.startsWith('/vobiz-stream') ? 'Vobiz Outbound' : 'WebRTC Outbound Simulator';
        }

        // Fetch previous call records to compute dynamic billing cost
        let prevTotalSeconds = 0;
        const { data: previousCalls, error: prevErr } = await supabase
          .from('call_logs')
          .select('duration_seconds')
          .eq('organization_id', agentConfig.organization_id);
          
        if (!prevErr && previousCalls) {
          prevTotalSeconds = previousCalls.reduce((sum, c) => sum + (c.duration_seconds || 0), 0);
        } else if (prevErr) {
          console.error('[Supabase] Error fetching previous call logs for billing:', prevErr.message);
        }

        const FREE_SECONDS_LIMIT = 600 * 60; // 36,000 seconds (600 minutes)
        const RATE_PER_MINUTE = 3.5; // ₹3.5/min
        const RATE_PER_SECOND = RATE_PER_MINUTE / 60;
        
        let calculatedCost = 0;
        const newTotalSeconds = prevTotalSeconds + callDuration;
        
        if (prevTotalSeconds >= FREE_SECONDS_LIMIT) {
          calculatedCost = callDuration * RATE_PER_SECOND;
        } else if (newTotalSeconds > FREE_SECONDS_LIMIT) {
          const billableSeconds = newTotalSeconds - FREE_SECONDS_LIMIT;
          calculatedCost = billableSeconds * RATE_PER_SECOND;
        } else {
          calculatedCost = 0;
        }
        
        const finalCost = Number(calculatedCost.toFixed(4));
        console.log(`[Billing] Org: ${agentConfig.organization_id}. Prev duration: ${prevTotalSeconds}s. Call duration: ${callDuration}s. New total: ${newTotalSeconds}s. Calculated Cost: ₹ ${finalCost}`);

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
            cost: finalCost,
            call_sid: callSid || null
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
        if (contactId && contactId !== 'direct') {
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
  console.log(` VoxAura.AI Voice Gateway Server running on port ${PORT}`);
  console.log(` WebRTC Stream Path: ws://localhost:${PORT}/webRTC-stream`);
  console.log(` Twilio Stream Path: ws://localhost:${PORT}/media-stream`);
  console.log(`===========================================================`);
});
