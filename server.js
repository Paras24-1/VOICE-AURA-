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
const activeCallContextsByPhone = new Map(); // Map to resolve context via customer phone number fallback
const pendingCallRecordings = new Map(); // Map to cache recording URLs to resolve race condition
const callDebugLogs = new Map(); // Map to store programmatic recording debug logs

// Helper to format target transfer numbers to E.164 format
function formatTransferNumber(number, defaultCallerId = '') {
  if (!number) return number;
  let cleaned = number.replace(/[^\d+]/g, '');
  if (cleaned.length === 10 && !cleaned.startsWith('+')) {
    let countryCode = '+91'; // Default country code
    const callerSource = defaultCallerId || process.env.VOBIZ_CALLER_ID || '';
    if (callerSource) {
      const cleanedCaller = callerSource.replace(/[^\d+]/g, '');
      if (cleanedCaller.startsWith('+')) {
        const prefix = cleanedCaller.slice(0, -10);
        if (prefix) countryCode = prefix;
      } else if (cleanedCaller.length > 10) {
        countryCode = '+' + cleanedCaller.slice(0, -10);
      }
    }
    cleaned = countryCode + cleaned;
  } else if (!cleaned.startsWith('+') && cleaned.length > 10) {
    cleaned = '+' + cleaned;
  }
  return cleaned;
}

// Helper to identify dummy/hallucinated phone numbers
function isDummyPhoneNumber(phone) {
  if (!phone) return true;
  // Remove non-digit characters
  const digits = phone.replace(/[^\d]/g, '');
  if (!digits || digits.length < 8) return true;
  
  // Check common dummy sequences
  const dummySequences = [
    '123456789',
    '987654321',
    '012345678',
    '876543210',
    '1234567890',
    '9876543210',
    '5555555'
  ];
  for (const seq of dummySequences) {
    if (digits.includes(seq)) return true;
  }

  // Check repeating digits (e.g., all 9s, all 1s, etc.)
  const firstDigit = digits[0];
  let allRepeating = true;
  for (let i = 1; i < digits.length; i++) {
    if (digits[i] !== firstDigit) {
      allRepeating = false;
      break;
    }
  }
  if (allRepeating) return true;

  return false;
}

// CRM Database Client Initialization (points to WhatsApp Dashboard database)
const crmSupabaseUrl = process.env.CRM_SUPABASE_URL;
const crmSupabaseServiceKey = process.env.CRM_SUPABASE_SERVICE_ROLE_KEY;
let crmSupabase = null;

if (crmSupabaseUrl && crmSupabaseServiceKey) {
  crmSupabase = createClient(crmSupabaseUrl, crmSupabaseServiceKey);
  console.log('[CRM Database] Client initialized successfully for cross-database assignments.');
} else {
  console.warn('[CRM Database] Warning: Missing CRM_SUPABASE_URL or CRM_SUPABASE_SERVICE_ROLE_KEY environment variables. Inbound employee routing fallback will not be active.');
}

// Helper to query CRM database and resolve the assigned employee for a given customer phone number
async function lookupCrmAssignedEmployee(customerPhone) {
  if (!crmSupabase || !customerPhone) return null;
  try {
    const cleanPhone = customerPhone.replace(/[^\d]/g, '');
    if (!cleanPhone) return null;
    const last10 = cleanPhone.slice(-10);
    
    console.log(`[CRM Lookup] Searching CRM database for customer phone matching last 10 digits: "${last10}"`);
    
    // 1. Find conversation
    const { data: conversation, error: convError } = await crmSupabase
      .from('conversations')
      .select('id, assigned_to')
      .ilike('phone_number', `%${last10}%`)
      .maybeSingle();
      
    if (convError || !conversation) {
      console.log(`[CRM Lookup] No conversation found in CRM database for "${last10}"`);
      return null;
    }
    
    if (!conversation.assigned_to) {
      console.log(`[CRM Lookup] Conversation found but not assigned to any employee.`);
      return null;
    }
    
    // 2. Fetch employee details
    const { data: employee, error: empError } = await crmSupabase
      .from('users')
      .select('name, phone')
      .eq('id', conversation.assigned_to)
      .maybeSingle();
      
    if (empError || !employee) {
      console.log(`[CRM Lookup] Failed to fetch employee details for user ID ${conversation.assigned_to}`);
      return null;
    }
    
    console.log(`[CRM Lookup] Found assigned employee: ${employee.name} (Phone: ${employee.phone})`);
    return {
      assigned_employee_name: employee.name || '',
      assigned_employee_phone: employee.phone || ''
    };
  } catch (err) {
    console.error('[CRM Lookup] Error searching CRM database:', err);
    return null;
  }
}

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

// Helper to add call debugging logs
function addCallDebugLog(callUuid, msg) {
  if (!callUuid) return;
  if (!callDebugLogs.has(callUuid)) {
    callDebugLogs.set(callUuid, []);
  }
  callDebugLogs.get(callUuid).push(`[${new Date().toISOString()}] ${msg}`);
}

// Programmatic call recording trigger via Vobiz API
async function startVobizRecording(callUuid, reqHost) {
  const authId = process.env.VOBIZ_AUTH_ID;
  const authToken = process.env.VOBIZ_AUTH_TOKEN;
  addCallDebugLog(callUuid, `startVobizRecording invoked. authId exists: ${!!authId}, authToken exists: ${!!authToken}`);
  if (!authId || !authToken || !callUuid) return;

  const resolvedHost = reqHost || process.env.PUBLIC_URL || process.env.NEXT_PUBLIC_APP_URL || 'https://voice-aura-production.up.railway.app';
  const protocol = resolvedHost.startsWith('localhost') || resolvedHost.startsWith('127.0.0.1') ? 'http' : 'https';
  const callbackUrl = resolvedHost.startsWith('http') ? `${resolvedHost}/api/vobiz/events` : `${protocol}://${resolvedHost}/api/vobiz/events`;

  const url = `https://api.vobiz.ai/api/v1/Account/${authId}/Call/${callUuid}/Record/`;
  addCallDebugLog(callUuid, `Requesting Vobiz API: POST ${url} with callback: ${callbackUrl}`);
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Auth-ID': authId,
        'X-Auth-Token': authToken
      },
      body: JSON.stringify({
        file_format: 'mp3',
        callback_url: callbackUrl,
        callbackUrl: callbackUrl,
        action: callbackUrl,
        callback_method: 'POST',
        callbackMethod: 'POST'
      })
    });
    const status = response.status;
    const txt = await response.text();
    addCallDebugLog(callUuid, `Vobiz API Response Status: ${status}, Body: ${txt}`);
  } catch (err) {
    addCallDebugLog(callUuid, `Vobiz API Error: ${err.message}`);
  }
}

// Vobiz Outbound dialer integration
async function initiateVobizCall(contact, agentId) {
  const authId = process.env.VOBIZ_AUTH_ID;
  const authToken = process.env.VOBIZ_AUTH_TOKEN;
  let callerId = process.env.VOBIZ_CALLER_ID;
  let resolvedOrgId = null;

  // Fetch agent configuration and organization ID
  if (supabase && agentId && agentId !== 'default' && agentId !== 'new') {
    try {
      const { data, error } = await supabase
        .from('agents')
        .select('telephone_number, organization_id')
        .eq('id', agentId)
        .maybeSingle();
        
      if (data) {
        if (data.telephone_number) {
          callerId = data.telephone_number;
          console.log(`[Vobiz] Using agent-specific caller ID: ${callerId} for agent ${agentId}`);
        }
        resolvedOrgId = data.organization_id;
      }
    } catch (dbErr) {
      console.error('[Vobiz] Error fetching agent config from Supabase:', dbErr);
    }
  }

  // Verify wallet balance if organization is resolved
  if (supabase && resolvedOrgId) {
    try {
      const { data: orgData } = await supabase
        .from('organizations')
        .select('wallet_balance')
        .eq('id', resolvedOrgId)
        .maybeSingle();

      if (orgData && orgData.wallet_balance !== undefined && orgData.wallet_balance !== null) {
        const balance = Number(orgData.wallet_balance) || 0;
        if (balance <= 0) {
          console.warn(`[Vobiz Call Blocked] Insufficient wallet balance (₹${balance}) for Org ${resolvedOrgId}`);
          throw new Error('Insufficient wallet balance');
        }
      }
    } catch (balanceErr) {
      console.error('[Vobiz Call Check] Wallet verification error:', balanceErr.message);
      if (balanceErr.message === 'Insufficient wallet balance') {
        throw balanceErr;
      }
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

  const host = process.env.PUBLIC_URL || process.env.NEXT_PUBLIC_APP_URL || 'https://voice-aura-production.up.railway.app';
  const answerUrl = `${host}/api/vobiz/outbound-answer/${agentId}/${encodeURIComponent(cleanedTo)}${contact.id ? `/${contact.id}` : ''}`;

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
      answer_method: 'POST',
      hangup_url: `${host}/api/vobiz/events?contactId=${contact.id || 'direct'}&agentId=${agentId}`,
      hangup_method: 'POST'
    })
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Vobiz API returned ${response.status}: ${errText}`);
  }

  const data = await response.json();
  return { simulated: false, callSid: data.call_sid || data.id || data.CallUUID || data.call_uuid || data.request_uuid || data.RequestUUID };
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

            // Fetch current wallet balance
            let currentWalletBalance = 0;
            const { data: orgData, error: orgErr } = await supabase
              .from('organizations')
              .select('wallet_balance')
              .eq('id', campaign.organization_id)
              .maybeSingle();
            
            if (!orgErr && orgData) {
              currentWalletBalance = Number(orgData.wallet_balance) || 0;
            } else if (orgErr) {
              console.error('[Supabase Campaign Mock] Error fetching wallet balance:', orgErr.message);
            }

            const RATE_PER_MINUTE = 3.5; // ₹3.5/min
            const RATE_PER_SECOND = RATE_PER_MINUTE / 60;
            const calculatedCost = mockDuration * RATE_PER_SECOND;
            const finalCost = Number(calculatedCost.toFixed(4));

            // Deduct balance
            const newBalance = Math.max(0, Number((currentWalletBalance - finalCost).toFixed(4)));

            // Update wallet balance in organizations table
            const { error: balanceUpdateErr } = await supabase
              .from('organizations')
              .update({ wallet_balance: newBalance })
              .eq('id', campaign.organization_id);

            if (balanceUpdateErr) {
              console.error('[Supabase Campaign Mock] Error updating wallet balance:', balanceUpdateErr.message);
            } else {
              console.log(`[Supabase Campaign Mock] Deducted ₹${finalCost} from Org ${campaign.organization_id}. Old Balance: ₹${currentWalletBalance}, New Balance: ₹${newBalance}`);
            }

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

// Webhook request tracker for debugging
const globalWebhookTracker = [];

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use((req, res, next) => {
  if (req.path.startsWith('/api/vobiz/')) {
    globalWebhookTracker.push({
      timestamp: new Date().toISOString(),
      path: req.path,
      method: req.method,
      query: req.query,
      body: req.body,
      headers: {
        'host': req.headers.host,
        'content-type': req.headers['content-type']
      }
    });
    if (globalWebhookTracker.length > 100) {
      globalWebhookTracker.shift();
    }
  }
  next();
});

// Endpoint to view tracked webhooks
app.get('/api/debug/webhooks', (req, res) => {
  res.json(globalWebhookTracker);
});

// Proxy endpoint to stream Vobiz recordings with proper authorization headers
app.all('/api/recordings/proxy', async (req, res) => {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Range, X-Requested-With');
  res.setHeader('Access-Control-Expose-Headers', 'Content-Range, Content-Length, Accept-Ranges');

  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }

  const targetUrl = req.query.url;
  if (!targetUrl) {
    return res.status(400).send('Missing url parameter');
  }

  // Security: only allow proxying URLs from media.vobiz.ai or api.vobiz.ai domains
  try {
    const parsedUrl = new URL(targetUrl);
    if (parsedUrl.hostname !== 'media.vobiz.ai' && parsedUrl.hostname !== 'api.vobiz.ai') {
      return res.status(403).send('Forbidden target host');
    }
  } catch (err) {
    return res.status(400).send('Invalid url parameter');
  }

  const authId = process.env.VOBIZ_AUTH_ID;
  const authToken = process.env.VOBIZ_AUTH_TOKEN;

  if (!authId || !authToken) {
    return res.status(500).send('Missing Vobiz configuration on server');
  }

  try {
    console.log(`[Recording Proxy] Fetching audio from: ${targetUrl}, Range requested: ${req.headers.range || 'none'}`);
    const fetchHeaders = {
      'X-Auth-ID': authId,
      'X-Auth-Token': authToken
    };
    
    // Forward Range header from client to support HTML5 seekers (critical for Safari/Chrome compatibility)
    if (req.headers.range) {
      fetchHeaders['Range'] = req.headers.range;
    }

    const response = await fetch(targetUrl, {
      headers: fetchHeaders
    });

    if (!response.ok && response.status !== 206) {
      const errText = await response.text();
      console.error(`[Recording Proxy] Error fetching audio from Vobiz: ${response.status} - ${errText}`);
      return res.status(response.status).send(`Error from Vobiz: ${errText}`);
    }

    // Set matching status code (e.g. 200 OK or 206 Partial Content)
    res.status(response.status);

    // Forward content headers
    res.setHeader('Content-Type', response.headers.get('content-type') || 'audio/mpeg');
    
    const contentLength = response.headers.get('content-length');
    if (contentLength) {
      res.setHeader('Content-Length', contentLength);
    }
    
    const contentRange = response.headers.get('content-range');
    if (contentRange) {
      res.setHeader('Content-Range', contentRange);
    }
    
    const acceptRanges = response.headers.get('accept-ranges');
    if (acceptRanges) {
      res.setHeader('Accept-Ranges', acceptRanges);
    }

    // Pipe stream to express response
    const body = response.body;
    if (body) {
      if (typeof body.pipe === 'function') {
        body.pipe(res);
      } else {
        const { Readable } = require('stream');
        Readable.fromWeb(body).pipe(res);
      }
    } else {
      res.status(500).send('No body returned from Vobiz');
    }
  } catch (err) {
    console.error(`[Recording Proxy] Request failed:`, err.message);
    res.status(500).send(`Internal error: ${err.message}`);
  }
});

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
  // Vobiz sends caller ID under various field names — try all of them
  const fromNumber = req.body.From || req.body.from || req.body.CallerID || req.body.caller_id || 
    req.body.Caller || req.body.caller || req.body.CallerNumber || req.body.caller_number ||
    req.body.OriginatorCallerID || req.body.originator_caller_id || req.body.ANI || req.body.ani ||
    req.body.CallerId || req.body.callerid || req.body.cli || req.body.CLI ||
    req.query.From || req.query.from || req.query.CallerID || req.query.caller_id || 
    req.query.Caller || req.query.caller || req.query.ANI || req.query.ani || '';
  console.log(`[Vobiz] Incoming call received, routing to agent: ${agentId}, CallUUID: ${callUuid}, From: ${fromNumber || '(no phone captured)'}`);
  console.log(`[Vobiz] Incoming webhook body fields:`, JSON.stringify(req.body));

  // Verify wallet balance
  let hasBalance = true;
  let balance = 0;
  if (supabase && agentId && agentId !== 'default' && agentId !== 'new') {
    try {
      const { data: agent } = await supabase
        .from('agents')
        .select('organization_id')
        .eq('id', agentId)
        .maybeSingle();

      if (agent && agent.organization_id) {
        const { data: org } = await supabase
          .from('organizations')
          .select('wallet_balance')
          .eq('id', agent.organization_id)
          .maybeSingle();

        if (org && org.wallet_balance !== undefined && org.wallet_balance !== null) {
          balance = Number(org.wallet_balance) || 0;
          if (balance <= 0) {
            hasBalance = false;
          }
        }
      }
    } catch (err) {
      console.error('[Vobiz Inbound Balance Check] Error:', err);
    }
  }

  if (!hasBalance) {
    console.log(`[Vobiz Inbound] Blocking inbound call for agent ${agentId}. Insufficient balance: ₹${balance}`);
    res.type('text/xml');
    res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Speak voice="WOMAN" language="en-US">Sorry, the account has insufficient balance to complete this call. Please recharge your wallet.</Speak>
  <Hangup />
</Response>`);
    return;
  }
  
  const host = req.headers.host;
  const protocol = req.headers['x-forwarded-proto'] === 'https' ? 'wss' : 'ws';

  if (callUuid) {
    startVobizRecording(callUuid, host);
  }

  res.type('text/xml');
  res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Speak voice="WOMAN" language="en-US">Connecting you to Vox AI...</Speak>
  <Stream bidirectional="true" keepCallAlive="true" contentType="audio/x-l16;rate=8000">${protocol}://${host}/vobiz-stream/${agentId}?callUuid=${callUuid}&amp;customerPhone=${encodeURIComponent(fromNumber)}</Stream>
</Response>`);
});

// Basic Health Check Route
app.get('/health', (req, res) => {
  res.json({ status: 'healthy', timestamp: new Date() });
});

// Vobiz Outbound Answer webhook (supports path params to prevent carrier query parameter stripping)
app.post([
  '/api/vobiz/outbound-answer',
  '/api/vobiz/outbound-answer/:agentId/:customerPhone',
  '/api/vobiz/outbound-answer/:agentId/:customerPhone/:contactId'
], async (req, res) => {
  const agentId = req.params.agentId || req.query.agentId || '';
  const contactId = req.params.contactId || req.query.contactId || '';

  // Verify wallet balance
  let hasBalance = true;
  let balance = 0;
  if (supabase && agentId && agentId !== 'default' && agentId !== 'new') {
    try {
      const { data: agent } = await supabase
        .from('agents')
        .select('organization_id')
        .eq('id', agentId)
        .maybeSingle();

      if (agent && agent.organization_id) {
        const { data: org } = await supabase
          .from('organizations')
          .select('wallet_balance')
          .eq('id', agent.organization_id)
          .maybeSingle();

        if (org && org.wallet_balance !== undefined && org.wallet_balance !== null) {
          balance = Number(org.wallet_balance) || 0;
          if (balance <= 0) {
            hasBalance = false;
          }
        }
      }
    } catch (err) {
      console.error('[Vobiz Outbound Answer Balance Check] Error:', err);
    }
  }

  if (!hasBalance) {
    console.log(`[Vobiz Outbound Answer] Blocking call bridge for agent ${agentId}. Insufficient balance: ₹${balance}`);
    res.type('text/xml');
    res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Speak voice="WOMAN" language="en-US">Sorry, the account has insufficient balance to complete this call. Please recharge your wallet.</Speak>
  <Hangup />
</Response>`);
    return;
  }
  
  // Resolve customer phone dynamically from path params, query params, or webhook body
  let customerPhone = req.params.customerPhone || req.query.customerPhone || req.body.To || req.body.to || req.query.To || req.query.to || '';
  if (!customerPhone) {
    customerPhone = req.body.From || req.body.from || req.query.From || req.query.from || '';
  }

  const callUuid = req.body.CallUUID || req.body.call_uuid || req.body.CallSid || req.body.call_sid || req.query.call_uuid || req.query.CallUUID || '';
  console.log(`[Vobiz Webhook] Outbound call answered for contactId=${contactId}, agentId=${agentId}, CallUUID=${callUuid}, Customer Phone: ${customerPhone || 'N/A'}`);

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
  let contextData = activeCallContexts.get(callUuid);
  if (!contextData && customerPhone) {
    const cleanPhone = customerPhone.replace(/[^\d]/g, '');
    if (cleanPhone) {
      const phoneKey = cleanPhone.slice(-10);
      contextData = activeCallContextsByPhone.get(phoneKey);
      if (contextData) {
        console.log(`[Vobiz Webhook] Resolved context from phone key ${phoneKey} for CallUUID ${callUuid}`);
        activeCallContexts.set(callUuid, contextData);
      }
    }
  }

  let streamUrl = `${protocol}://${host}/vobiz-stream/${agentId}/${contactId || 'direct'}?callUuid=${callUuid}&amp;customerPhone=${encodeURIComponent(customerPhone || '')}`;
  if (contextData) {
    streamUrl += `&amp;context=${encodeURIComponent(JSON.stringify(contextData))}`;
  }

  if (callUuid) {
    startVobizRecording(callUuid, host);
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
  const targetNumberRaw = req.query.targetNumber || process.env.DEFAULT_HANDOVER_NUMBER || '915555555555';
  const callerIdRaw = req.query.callerId || process.env.VOBIZ_CALLER_ID || '';
  
  // Strip leading '+' sign as Vobiz/telephony gateways do not support the '+' symbol in VoiceXML Dialing
  const targetNumber = targetNumberRaw.replace(/^\+/, '');
  const callerId = callerIdRaw.replace(/^\+/, '');
  
  console.log(`[Vobiz Transfer Webhook] Transferring call to: ${targetNumber} (raw: ${targetNumberRaw}), callerId: ${callerId} (raw: ${callerIdRaw})`);
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
  let params = method === 'GET' ? req.query : req.body;

  // Vobiz Recording API callbacks wrap the JSON payload inside a string under the "response" key
  if (params.response && typeof params.response === 'string') {
    try {
      const parsed = JSON.parse(params.response);
      params = { ...params, ...parsed };
      console.log(`[Vobiz Event] Parsed nested 'response' JSON:`, JSON.stringify(parsed));
    } catch (e) {
      console.error(`[Vobiz Event] Error parsing nested 'response' JSON:`, e.message);
    }
  }

  const event = params.event;
  const status = params.status || params.CallStatus || '';
  
  console.log(`[Vobiz Event] Call event (${method}): contactId=${contactId}, event=${event}, status=${status}, query:`, JSON.stringify(req.query), `body:`, JSON.stringify(req.body));

  const callUuid = params.CallUUID || params.call_uuid || params.calluuid || params.CallSid || params.call_sid || params.callsid || req.query.CallUUID || req.query.call_uuid || req.query.calluuid || req.query.CallSid || req.query.call_sid || '';
  const finalDuration = Number(params.Duration || params.duration || params.Billsec || params.billsec || params.BillDuration || params.bill_duration || req.query.Duration || req.query.duration || req.query.Billsec || req.query.billsec || req.query.BillDuration || req.query.bill_duration || 0);
  const dialDuration = Number(params.DialCallDuration || params.dial_call_duration || req.query.DialCallDuration || req.query.dial_call_duration || 0);

  const isDialEnded = (req.query.action === 'dial-ended');

  // If a call event is received, find and update/log the call log
  if (supabase && callUuid) {
    try {
      const recordingUrl = params.RecordUrl || params.RecordURL || params.recording_url || params.RecordingUrl || params.RecordingURL || params.recordingUrl || params.record_url || params.recordUrl || req.query.RecordUrl || req.query.RecordURL || req.query.RecordingUrl || req.query.RecordingURL || req.query.recordingUrl || req.query.record_url || req.query.recordUrl || '';
      if (recordingUrl) {
        pendingCallRecordings.set(callUuid, recordingUrl);
        console.log(`[Vobiz Event] Cached pending recording URL for CallUUID ${callUuid}: ${recordingUrl}`);
      }

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
        // Append diagnostic event payload to transcript for remote debugging
        const debugText = `${callLog.transcript || ''}\n\n[DEBUG EVENT] Method: ${method}, Action: ${req.query.action || 'none'}, Params: ${JSON.stringify(params)}, Query: ${JSON.stringify(req.query)}`;
        await supabase
          .from('call_logs')
          .update({ transcript: debugText })
          .eq('id', callLog.id);

        const recordingUrl = params.RecordUrl || params.RecordURL || params.recording_url || params.RecordingUrl || params.RecordingURL || params.recordingUrl || params.record_url || params.recordUrl || req.query.RecordUrl || req.query.RecordURL || req.query.RecordingUrl || req.query.RecordingURL || req.query.recordingUrl || req.query.record_url || req.query.recordUrl || '';

        // If we have new duration details, update them
        let hasNewDuration = false;
        let newDuration = 0;
        if (isDialEnded) {
          newDuration = (callLog.duration_seconds || 0) + dialDuration;
        } else if (finalDuration > 0) {
          newDuration = finalDuration + 5;
        }

        if (newDuration > 0 && newDuration > (callLog.duration_seconds || 0)) {
          hasNewDuration = true;
        }

        if (hasNewDuration || recordingUrl) {
          const updatePayload = {};
          if (recordingUrl) {
            updatePayload.recording_url = recordingUrl;
            console.log(`[Vobiz Event] Found recording URL for call ${callLog.id}: ${recordingUrl}`);
          }

          if (hasNewDuration) {
            const RATE_PER_MINUTE = 3.5; // ₹3.5/min
            const RATE_PER_SECOND = RATE_PER_MINUTE / 60;
            const calculatedCost = newDuration * RATE_PER_SECOND;
            const finalCost = Number(calculatedCost.toFixed(4));
            
            const additionalCost = Number((finalCost - (callLog.cost || 0)).toFixed(4));

            console.log(`[Vobiz Event] Updating call log ${callLog.id}: New Duration: ${newDuration}s (Padded/Bridged), New Cost: ₹ ${finalCost}, Additional Cost: ₹${additionalCost}`);

            // Fetch current wallet balance
            let currentWalletBalance = 0;
            const { data: orgData, error: orgErr } = await supabase
              .from('organizations')
              .select('wallet_balance')
              .eq('id', callLog.organization_id)
              .maybeSingle();
            
            if (!orgErr && orgData) {
              currentWalletBalance = Number(orgData.wallet_balance) || 0;
            } else if (orgErr) {
              console.error('[Supabase Event Hook] Error fetching wallet balance:', orgErr.message);
            }

            // Deduct additional cost if any
            if (additionalCost > 0) {
              const newBalance = Math.max(0, Number((currentWalletBalance - additionalCost).toFixed(4)));
              
              const { error: balanceUpdateErr } = await supabase
                .from('organizations')
                .update({ wallet_balance: newBalance })
                .eq('id', callLog.organization_id);

              if (balanceUpdateErr) {
                console.error('[Supabase Event Hook] Error updating wallet balance:', balanceUpdateErr.message);
              } else {
                console.log(`[Supabase Event Hook] Deducted additional ₹${additionalCost} from Org ${callLog.organization_id}. Old Balance: ₹${currentWalletBalance}, New Balance: ₹${newBalance}`);
              }
            }

            updatePayload.duration_seconds = newDuration;
            updatePayload.cost = finalCost;
          }

          console.log(`[Vobiz Event] Updating call log ${callLog.id} with payload:`, JSON.stringify(updatePayload));
          const { error: updateErr } = await supabase
            .from('call_logs')
            .update(updatePayload)
            .eq('id', callLog.id);

          if (updateErr) {
            console.error(`[Vobiz Event] Error updating call log ${callLog.id}:`, updateErr.message);
          } else {
            console.log(`[Vobiz Event] Call log ${callLog.id} updated successfully.`);
          }
        } else {
          console.log(`[Vobiz Event] Skipped update: newDuration (${newDuration}s) is not greater than existing duration_seconds (${callLog.duration_seconds || 0}s) and no recording URL was found.`);
        }
      } else {
        console.log(`[Vobiz Event] No call log found in DB with call_sid=${callUuid}. Checking if call was missed/failed.`);
        
        const isMissedStatus = ['busy', 'no-answer', 'failed', 'timeout'].includes(String(status).toLowerCase()) ||
                               (String(status).toLowerCase() === 'completed' && finalDuration === 0 && !isDialEnded);
                               
        if (isMissedStatus) {
          let resolvedAgentId = req.query.agentId || req.body.agentId || '';
          let resolvedOrgId = '';
          
          const fromPhone = params.From || params.from || '';
          const toPhone = params.To || params.to || '';
          const direction = params.Direction || params.direction || 'outbound';
          
          if (!resolvedAgentId) {
            const virtualNumber = direction === 'inbound' ? toPhone : fromPhone;
            if (virtualNumber) {
              const cleanVirtual = virtualNumber.replace(/[^\d+]/g, '');
              console.log(`[Vobiz Event] Looking up agent by telephone number: "${cleanVirtual}"`);
              const { data: agent } = await supabase
                .from('agents')
                .select('id, organization_id')
                .or(`telephone_number.ilike.%${cleanVirtual.slice(-10)}%`)
                .maybeSingle();
              if (agent) {
                resolvedAgentId = agent.id;
                resolvedOrgId = agent.organization_id;
              }
            }
          } else {
            const { data: agent } = await supabase
              .from('agents')
              .select('organization_id')
              .eq('id', resolvedAgentId)
              .maybeSingle();
            if (agent) {
              resolvedOrgId = agent.organization_id;
            }
          }
          
          if (resolvedOrgId && resolvedAgentId) {
            let logStatus = 'failed';
            const lowerStatus = String(status).toLowerCase();
            if (lowerStatus.includes('busy')) logStatus = 'busy';
            else if (lowerStatus.includes('no-answer') || lowerStatus.includes('no_answer')) logStatus = 'no-answer';
            
            console.log(`[Vobiz Event] Logging missed call for Org=${resolvedOrgId}, Agent=${resolvedAgentId}, CallUUID=${callUuid}, Status=${logStatus}`);
            
            await supabase
              .from('call_logs')
              .insert({
                organization_id: resolvedOrgId,
                agent_id: resolvedAgentId,
                from_phone_number: fromPhone,
                to_phone_number: toPhone,
                duration_seconds: 0,
                status: logStatus,
                transcript: `[SYSTEM]: Call was not answered. Status: ${logStatus.toUpperCase()}.`,
                cost: 0,
                call_sid: callUuid
              });
          } else {
            console.warn(`[Vobiz Event] Could not resolve agent/org to log missed call. resolvedAgentId=${resolvedAgentId}, resolvedOrgId=${resolvedOrgId}`);
          }
        }
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
    // Fetch campaign to get organization_id
    const { data: fetchCampaign, error: fetchErr } = await supabase
      .from('campaigns')
      .select('organization_id')
      .eq('id', campaignId)
      .maybeSingle();

    if (fetchErr || !fetchCampaign) {
      return res.status(404).send('Campaign not found');
    }

    // Verify wallet balance
    const { data: orgData, error: orgErr } = await supabase
      .from('organizations')
      .select('wallet_balance')
      .eq('id', fetchCampaign.organization_id)
      .maybeSingle();

    if (!orgErr && orgData && orgData.wallet_balance !== undefined && orgData.wallet_balance !== null) {
      const balance = Number(orgData.wallet_balance) || 0;
      if (balance <= 0) {
        return res.status(400).send('Insufficient wallet balance. Please recharge your wallet.');
      }
    }

    const { data: campaign, error } = await supabase
      .from('campaigns')
      .update({ status: 'running' })
      .eq('id', campaignId)
      .select()
      .single();

    if (error || !campaign) {
      return res.status(404).send('Campaign not found or failed to update');
    }

    // If n8n webhook URL is set, trigger n8n and do not run internal queue
    const n8nVoiceCampaignUrl = process.env.N8N_VOICE_CAMPAIGN_WEBHOOK_URL;
    if (n8nVoiceCampaignUrl) {
      // Fetch all pending contacts for this campaign
      const { data: pendingContacts, error: contactsErr } = await supabase
        .from('campaign_contacts')
        .select('*')
        .eq('campaign_id', campaignId)
        .eq('status', 'pending');

      if (!contactsErr && pendingContacts && pendingContacts.length > 0) {
        console.log(`[Campaign API] Triggering n8n voice campaign webhook for campaign ${campaignId} with ${pendingContacts.length} contacts...`);
        // Trigger n8n webhook asynchronously
        fetch(n8nVoiceCampaignUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            campaign_id: campaignId,
            agent_id: campaign.agent_id,
            contacts: pendingContacts.map(c => ({
              id: c.id,
              name: c.name,
              phone_number: c.phone_number
            }))
          })
        }).catch(err => console.error('[Campaign API] Error triggering n8n webhook:', err.message));
      }
    } else {
      runCampaignQueue(campaignId);
    }

    return res.json({ success: true, campaign });
  } catch (err) {
    console.error('[Campaign API] Error starting campaign:', err);
    return res.status(500).send(err.message);
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

app.post('/api/calls/trigger', async (req, res) => {
  const { phone_number, name, agentId, contactId, context } = req.body;
  if (!phone_number) {
    return res.status(400).json({ error: 'Missing phone_number in request body' });
  }
  
  const targetAgentId = agentId || 'default';
  console.log(`[Trigger Call API] Received request to dial ${phone_number} (Name: ${name || 'N/A'}, contactId: ${contactId || 'N/A'}) for agent: ${targetAgentId}`);

  try {
    const contact = {
      id: contactId || undefined,
      phone_number: phone_number,
      name: name || 'Direct Call Lead'
    };
    
    const result = await initiateVobizCall(contact, targetAgentId);
    
    // Store custom lead context if provided
    const callUuid = result.callSid || 'simulated';
    if (context) {
      activeCallContexts.set(callUuid, context);
      console.log(`[Trigger Call API] Stored context for CallUUID ${callUuid}:`, JSON.stringify(context));

      const cleanPhone = phone_number.replace(/[^\d]/g, '');
      if (cleanPhone) {
        const phoneKey = cleanPhone.slice(-10);
        activeCallContextsByPhone.set(phoneKey, context);
        console.log(`[Trigger Call API] Stored context by phone key ${phoneKey}:`, JSON.stringify(context));
      }
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
  
  let agentId = url.searchParams.get('agentId') || url.searchParams.get('amp;agentId');
  let contactId = url.searchParams.get('contactId') || url.searchParams.get('amp;contactId');
  let callSid = url.searchParams.get('callSid') || url.searchParams.get('callUuid') || url.searchParams.get('amp;callUuid') || url.searchParams.get('amp;callSid');
  let customerPhone = url.searchParams.get('customerPhone') || url.searchParams.get('amp;customerPhone') || '';

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
  let contextParam = url.searchParams.get('context') || url.searchParams.get('amp;context');
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
  if (!leadContext && customerPhone) {
    const cleanPhone = customerPhone.replace(/[^\d]/g, '');
    if (cleanPhone) {
      const phoneKey = cleanPhone.slice(-10);
      leadContext = activeCallContextsByPhone.get(phoneKey);
      if (leadContext) {
        console.log(`[WebSocket] Resolved leadContext from phone key ${phoneKey} for callSid/callUuid ${callSid}`);
        if (callSid) {
          activeCallContexts.set(callSid, leadContext);
        }
      }
    }
  }

  // Fallback: Query CRM database directly if leadContext is missing or does not have assigned employee details
  if ((!leadContext || !leadContext.assigned_employee_phone) && customerPhone) {
    console.log(`[WebSocket] Lead context or employee phone is missing. Querying CRM database fallback for customerPhone: ${customerPhone}`);
    const crmEmployee = await lookupCrmAssignedEmployee(customerPhone);
    if (crmEmployee) {
      leadContext = {
        ...(leadContext || {}),
        ...crmEmployee
      };
      if (callSid) {
        activeCallContexts.set(callSid, leadContext);
      }
      console.log(`[WebSocket] Resolved and merged CRM employee context:`, JSON.stringify(crmEmployee));
    }
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
                // Per-tenant voice: set via agent settings dashboard (voice_profile column in agents table)
                // Supported values: Aoede (female/bright), Kore (female/warm), Puck (male/playful),
                //                   Charon (male/deep), Fenrir (male/bold)
                voiceName: agentConfig.voice_profile || "Aoede"
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
                return systemPromptText + '\n\nIf the user requests to speak to a human or transfer the call, invoke the `transferCall` tool. Suggest transferring if the user is frustrated or if their request is beyond your capabilities.\n\nIMPORTANT: Speak at a slightly slower, calm, and conversational pace. Take brief pauses between sentences to ensure clear, natural, and friendly communication.';
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
            // Context diagnostics logging
            console.log(`[Gemini ToolCall] Diagnosing closure leadContext:`, JSON.stringify(leadContext));

            let rawTarget = '';
            
            // 1. Prioritize LLM tool call argument targetNumber if it is a valid, non-dummy number
            if (fc.args && fc.args.targetNumber && !isDummyPhoneNumber(fc.args.targetNumber)) {
              rawTarget = fc.args.targetNumber;
              console.log(`[Gemini ToolCall] Using valid targetNumber from LLM argument: "${rawTarget}"`);
            }
            
            // 2. Fallback to dynamically assigned employee phone from leadContext
            if (!rawTarget && leadContext && (leadContext.assigned_employee_phone || leadContext.assignedEmployeePhone)) {
              rawTarget = leadContext.assigned_employee_phone || leadContext.assignedEmployeePhone;
              console.log(`[Gemini ToolCall] Using employee phone from leadContext: "${rawTarget}"`);
            }
            
            // 3. Fallback to agent custom transfer number or global default
            if (!rawTarget) {
              rawTarget = agentConfig.transfer_number
                || process.env.DEFAULT_HANDOVER_NUMBER
                || '+15555555555';
              console.log(`[Gemini ToolCall] Using agent/default fallback number: "${rawTarget}"`);
            }
            
            const targetNumber = formatTransferNumber(rawTarget, agentConfig.telephone_number);
            
            console.log(`[Gemini ToolCall] Initiating call transfer. Context employee phone: "${(leadContext && (leadContext.assigned_employee_phone || leadContext.assignedEmployeePhone)) || ''}", Agent transfer_number: "${agentConfig.transfer_number || ''}", Env default: "${process.env.DEFAULT_HANDOVER_NUMBER || ''}", Resolved Target: "${targetNumber}" (raw: "${rawTarget}"), Pathname: "${pathname}"`);
            
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
                
                const protocol = request.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http';
                const reqHost = request.headers.host;
                let redirectUrl = `${protocol}://${reqHost}/api/vobiz/transfer-callback?targetNumber=${encodeURIComponent(targetNumber)}`;
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
                    aleg_method: 'POST',
                    hangup_url: `${protocol}://${reqHost}/api/vobiz/events`,
                    hangup_method: 'POST'
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

        // Retrieve current wallet balance
        let currentWalletBalance = 0;
        const { data: orgData, error: orgErr } = await supabase
          .from('organizations')
          .select('wallet_balance')
          .eq('id', agentConfig.organization_id)
          .maybeSingle();
        
        if (!orgErr && orgData) {
          currentWalletBalance = Number(orgData.wallet_balance) || 0;
        } else if (orgErr) {
          console.error('[Supabase] Error fetching wallet balance for deduction:', orgErr.message);
        }

        const RATE_PER_MINUTE = 3.5; // ₹3.5/min
        const RATE_PER_SECOND = RATE_PER_MINUTE / 60;
        const calculatedCost = callDuration * RATE_PER_SECOND;
        const finalCost = Number(calculatedCost.toFixed(4));
        
        // Deduct balance
        const newBalance = Math.max(0, Number((currentWalletBalance - finalCost).toFixed(4)));
        
        // Update wallet balance in organizations table
        const { error: balanceUpdateErr } = await supabase
          .from('organizations')
          .update({ wallet_balance: newBalance })
          .eq('id', agentConfig.organization_id);

        if (balanceUpdateErr) {
          console.error('[Supabase] Error updating wallet balance:', balanceUpdateErr.message);
        } else {
          console.log(`[Supabase] Deducted ₹${finalCost} from Org ${agentConfig.organization_id}. Old Balance: ₹${currentWalletBalance}, New Balance: ₹${newBalance}`);
        }

        let logFromPhone = fromPhone;
        let logToPhone = agentConfig.name;
        
        if (fromPhone === 'Vobiz VoiceXML') {
          logFromPhone = customerPhone || 'Vobiz VoiceXML';
        } else if (fromPhone === 'Vobiz Outbound') {
          logToPhone = customerPhone || 'Vobiz Outbound';
        }

        const finalRecordingUrl = callSid ? (pendingCallRecordings.get(callSid) || null) : null;
        if (finalRecordingUrl && callSid) {
          console.log(`[Supabase] Found pending recording URL for callSid ${callSid}: ${finalRecordingUrl}`);
          pendingCallRecordings.delete(callSid);
        }

        const debugLogs = callSid ? (callDebugLogs.get(callSid) || []) : [];
        if (callSid) {
          callDebugLogs.delete(callSid);
        }
        const finalTranscript = transcriptString + (debugLogs.length > 0 ? `\n\n[RECORDING DEBUG]\n${debugLogs.join('\n')}` : '');

        const { error } = await supabase
          .from('call_logs')
          .insert({
            organization_id: agentConfig.organization_id,
            agent_id: agentConfig.id,
            from_phone_number: logFromPhone,
            to_phone_number: logToPhone,
            duration_seconds: callDuration,
            status: 'completed',
            transcript: finalTranscript,
            cost: finalCost,
            call_sid: callSid || null,
            recording_url: finalRecordingUrl
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
