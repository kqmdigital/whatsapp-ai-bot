const fs = require('fs');
const path = require('path');
const { Client, RemoteAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const express = require('express');
const axios = require('axios');
const { createClient } = require('@supabase/supabase-js');

// --- Config ---
const PORT = process.env.PORT || 3000;
const SESSION_ID = process.env.WHATSAPP_SESSION_ID || 'default_session';
const BOT_VERSION = '1.0.0'; // Optional versioning
const startedAt = Date.now();
const N8N_WEBHOOK_URL = process.env.N8N_WEBHOOK_URL;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

console.log('🔍 Loaded N8N_WEBHOOK_URL:', N8N_WEBHOOK_URL);

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error('❌ Missing Supabase credentials. Exiting.');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const log = (level, message, ...args) => {
  const timestamp = new Date().toISOString();
  const formatted = `[${timestamp}] [${level.toUpperCase()}] [${SESSION_ID}] ${message}`;
  console[level](formatted, ...args);
};

// --- Supabase Store for WhatsApp Session ---
class SupabaseStore {
  constructor(supabaseClient, sessionId) {
    this.supabase = supabaseClient;
    this.sessionId = sessionId;
    log('info', `SupabaseStore initialized for session ID: ${this.sessionId}`);
  }

  async sessionExists({ session }) {
    try {
      const { count, error } = await this.supabase
        .from('whatsapp_sessions')
        .select('*', { count: 'exact', head: true })
        .eq('session_key', session);

      if (error) {
        log('error', `Supabase error in sessionExists: ${error.message}`);
        return false;
      }
      return count > 0;
    } catch (err) {
      log('error', `Exception in sessionExists: ${err.message}`);
      return false;
    }
  }

  async extract() {
    const { data, error } = await this.supabase
      .from('whatsapp_sessions')
      .select('session_data')
      .eq('session_key', this.sessionId)
      .limit(1)
      .single();

    if (error) return null;
    return data?.session_data || null;
  }

  async save(sessionData) {
    const { error } = await this.supabase
      .from('whatsapp_sessions')
      .upsert({ session_key: this.sessionId, session_data: sessionData }, { onConflict: 'session_key' });

    if (error) log('error', `Failed to save session: ${error.message}`);
  }

  async delete() {
    const { error } = await this.supabase
      .from('whatsapp_sessions')
      .delete()
      .eq('session_key', this.sessionId);

    if (error) log('error', `Failed to delete session: ${error.message}`);
  }
}

const supabaseStore = new SupabaseStore(supabase, SESSION_ID);
let client = null;
function createWhatsAppClient() {
  try {
    // First, ensure auth folder exists
    const sessionPath = path.join(__dirname, `.wwebjs_auth/session-${SESSION_ID}`);
    const parentDir = path.dirname(sessionPath);
    if (!fs.existsSync(parentDir)) {
      fs.mkdirSync(parentDir, { recursive: true });
      log('info', `📁 Created session directory: ${parentDir}`);
    }
    
    // Add .gitkeep to ensure folder is tracked
    const gitkeepPath = path.join(parentDir, '.gitkeep');
    if (!fs.existsSync(gitkeepPath)) {
      fs.writeFileSync(gitkeepPath, '');
      log('info', 'Added .gitkeep to session directory');
    }

    return new Client({
      authStrategy: new RemoteAuth({
        store: supabaseStore,
        backupSyncIntervalMs: 300000,
        dataPath: sessionPath,
      }),
      puppeteer: {
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--no-first-run',
          '--no-zygote',
          '--single-process',
          '--disable-gpu',
          // Additional memory-saving flags
          '--js-flags=--max-old-space-size=256',
          '--disable-extensions',
        ],
        // Set a reasonable timeout
        timeout: 120000,
      },
      qrTimeout: 90000, // Set a reasonable QR timeout
      // Add connection validation options
      restartOnAuthFail: true,
    });
  } catch (err) {
    log('error', `Failed to create WhatsApp client: ${err.message}`);
    return null;
  }
}

function setupClientEvents(c) {
 c.on('qr', qr => {
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?data=${encodeURIComponent(qr)}`;
  log('warn', `📱 Scan QR Code: ${qrUrl}`);
});

  c.on('ready', () => {
    log('info', '✅ WhatsApp client is ready.');
  });

  c.on('authenticated', () => {
    log('info', '🔐 Client authenticated.');
  });

  c.on('remote_session_saved', () => {
    log('info', '💾 Session saved to Supabase.');
  });

  c.on('disconnected', async reason => {
  log('warn', `Client disconnected: ${reason}`);
  if (client) {
    try {
      await client.destroy();
    } catch (err) {
      log('error', `Error destroying client after disconnect: ${err.message}`);
    }
    client = null;
  }
  
  // Exponential backoff for reconnection
  const attemptReconnection = (attempt = 1) => {
    const delay = Math.min(Math.pow(2, attempt) * 1000, 60000); // Cap at 60 seconds
    log('info', `Will attempt reconnection (#${attempt}) in ${delay/1000} seconds`);
    
    setTimeout(async () => {
      try {
        await startClient();
        
        // If still not connected, try again with increased backoff
        const state = await client?.getState();
        if (!client || state !== 'CONNECTED') {
          log('warn', `Reconnection attempt #${attempt} failed. State: ${state || 'No client'}`);
          attemptReconnection(attempt + 1);
        } else {
          log('info', `✅ Reconnected successfully after ${attempt} attempts`);
        }
      } catch (err) {
        log('error', `Error during reconnection attempt #${attempt}: ${err.message}`);
        attemptReconnection(attempt + 1);
      }
    }, delay);
  };
  
  attemptReconnection();
});

  c.on('auth_failure', async () => {
    log('error', '❌ Auth failed. Clearing session.');
    try {
      await supabaseStore.delete();
      log('info', 'Session deleted. Will attempt to reinitialize...');
      client = null;
      // Try to recover instead of exiting
      setTimeout(startClient, 10000);
    } catch (err) {
      log('error', `Failed to clean up after auth failure: ${err.message}`);
      // In extreme cases, exit might be necessary
      process.exit(1);
    }
  });

  c.on('message', handleIncomingMessage);
}

let messageCount = 0;

async function handleIncomingMessage(msg) {
  if (!msg.from.endsWith('@g.us')) return;

  const groupId = msg.from;
  const senderId = msg.author || msg.from;
  const text = msg.body || '';
  const messageId = msg?.id?.id?.toString?.() || '';

  let replyInfo = null;
  let hasReply = false;

  try {
    const quoted = await msg.getQuotedMessage?.();
    if (quoted?.id?.id) {
      hasReply = true;
      replyInfo = {
        message_id: quoted?.id?.id || null,
        text: quoted?.body || null,
      };
    }
  } catch (err) {
    log('warn', `⚠️ Failed to get quoted message: ${err.message}`);
  }

  const isImportant =
    text.toLowerCase().includes('valuation') ||
    (hasReply && replyInfo?.text?.toLowerCase().includes('valuation'));

  if (!isImportant) {
    log('info', '🚫 Ignored non-valuation message.');
    return;
  }

  // Memory logging every 50 messages
messageCount++;
if (messageCount % 50 === 0) {
  const mem = process.memoryUsage();
  const rssMB = (mem.rss / 1024 / 1024).toFixed(1);
  const heapMB = (mem.heapUsed / 1024 / 1024).toFixed(1);
  log('info', `🧠 Memory usage — RSS: ${rssMB} MB, Heap: ${heapMB} MB`);

  // Optional warning threshold
  if (parseFloat(rssMB) > 300) {
    log('warn', '⚠️ RSS memory usage above 300MB. Consider restarting or increasing instance size.');
  }
}

  const payload = {
    groupId,
    senderId,
    text,
    messageId,
    hasReply,
    replyInfo,
    timestamp: new Date(msg.timestamp * 1000).toISOString(),
  };

  await sendToN8nWebhook(payload);
}

async function sendToN8nWebhook(payload, attempt = 0) {
  if (!N8N_WEBHOOK_URL) {
    log('warn', 'Webhook skipped: N8N_WEBHOOK_URL not set.');
    return;
  }

  // Truncate long texts
  if (payload.text?.length > 1000) {
    payload.text = payload.text.slice(0, 1000) + '... [truncated]';
  }
  if (payload.replyInfo?.text?.length > 500) {
    payload.replyInfo.text = payload.replyInfo.text.slice(0, 500) + '... [truncated]';
  }

  // Estimate payload size
  const payloadSize = Buffer.byteLength(JSON.stringify(payload), 'utf8');
  if (payloadSize > 90_000) {
    log('warn', `🚫 Payload too large (${payloadSize} bytes). Skipping webhook.`);
    return;
  }

  try {
    await axios.post(N8N_WEBHOOK_URL, payload, { timeout: 10000 });
    log('info', `✅ Webhook sent (${payloadSize} bytes).`);
  } catch (err) {
    log('error', `Webhook attempt ${attempt + 1} failed: ${err.message}`);
    if (attempt < 4) { // Try up to 5 times
      const backoff = Math.min(Math.pow(2, attempt) * 1000, 15000); // Cap at 15 seconds
      log('warn', `Will retry webhook in ${backoff/1000} seconds...`);
      setTimeout(() => sendToN8nWebhook(payload, attempt + 1), backoff);
    } else {
      log('error', 'Giving up on webhook after 5 attempts');
    }
  }
}

async function startClient() {
  if (client) {
    log('info', '⏳ Client already exists, skipping re-init.');
    return;
  }

  log('info', '🚀 Starting WhatsApp client...');
  client = createWhatsAppClient();
  setupClientEvents(client);

  try {
    await client.initialize();
    log('info', '✅ WhatsApp client initialized.');
  } catch (err) {
    log('error', `❌ WhatsApp client failed to initialize: ${err.message}`);
    client = null;
  }
}

const app = express();
app.use(express.json());

// Graceful shutdown handling
const gracefulShutdown = async (signal) => {
  log('warn', `Received ${signal}. Shutting down gracefully...`);
  
  // Stop accepting new requests
  server.close(() => {
    log('info', 'HTTP server closed');
  });
  
  // Destroy WhatsApp client properly
  if (client) {
    try {
      log('info', 'Destroying WhatsApp client...');
      await client.destroy();
      log('info', 'WhatsApp client destroyed successfully');
    } catch (err) {
      log('error', `Error destroying client: ${err.message}`);
    }
  }
  
  // Exit with success code
  setTimeout(() => {
    log('info', 'Exiting process...');
    process.exit(0);
  }, 3000);
};

// Register shutdown handlers
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('unhandledRejection', (reason, promise) => {
  log('error', 'Unhandled Rejection at:', promise, 'reason:', reason);
  // Don't exit, just log
});

app.get('/', (_, res) => {
  res.status(200).json({
    status: '✅ Bot running',
    sessionId: SESSION_ID,
    version: BOT_VERSION,
    uptimeMinutes: Math.floor((Date.now() - startedAt) / 60000),
    timestamp: new Date().toISOString(),
  });
});
app.post('/send-message', async (req, res) => {
  const { groupId, message } = req.body;

  if (!groupId || !message) {
    return res.status(400).json({ success: false, error: 'Missing groupId or message' });
  }

  if (!client) {
    return res.status(503).json({ success: false, error: 'WhatsApp client not ready' });
  }

  try {
    const formattedGroupId = groupId.endsWith('@g.us') ? groupId : `${groupId}@g.us`;
    const sentMessage = await client.sendMessage(formattedGroupId, message);
    return res.status(200).json({ success: true, messageId: sentMessage.id.id });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

const server = app.listen(PORT, () => {
  log('info', `🚀 Server started on http://localhost:${PORT}`);
  log('info', `🤖 Bot Version: ${BOT_VERSION}`);
  log('info', '💻 Starting WhatsApp client in 3 seconds...');
  // Slight delay to ensure server is fully up
  setTimeout(startClient, 3000);
});

setInterval(async () => {
  if (!client) {
    log('warn', '🕵️ Watchdog: client is missing. Restarting...');
    await startClient();
    return;
  }

  try {
    const state = await client.getState();
    log('info', `✅ Watchdog: client state is "${state}".`);

    if (state !== 'CONNECTED') {
      log('warn', `⚠️ Watchdog detected bad state "${state}". Restarting client...`);
      await client.destroy();
      client = null;
      await startClient();
    }
  } catch (err) {
    log('error', `🚨 Watchdog error during state check: ${err.message}. Restarting...`);
    client = null;
    await startClient();
  }
}, 5 * 60 * 1000); // every 5 minutes

// Keep-alive endpoint
app.get('/ping', (_, res) => {
  res.status(200).send('pong');
});

// Self-ping mechanism (in addition to UptimeRobot)
let lastPingSent = 0;
const selfPing = async () => {
  try {
    // Only ping if we haven't received an external ping recently
    const now = Date.now();
    if (now - lastPingSent > 4 * 60 * 1000) { // 4 minutes
      lastPingSent = now;
      // Get the deployed URL from environment or construct it
      const appUrl = process.env.APP_URL || `http://localhost:${PORT}`;
      await axios.get(`${appUrl}/ping`, { timeout: 5000 });
      log('debug', '🏓 Self-ping successful');
    }
  } catch (err) {
    log('warn', `Self-ping failed: ${err.message}`);
  }
};

// Update your request handlers to record external pings
app.use((req, res, next) => {
  if (req.path === '/ping') {
    lastPingSent = Date.now();
  }
  next();
});

// Run self-ping every 4 minutes (in addition to UptimeRobot's 5 minutes)
setInterval(selfPing, 4 * 60 * 1000);

const checkMemoryUsage = () => {
  const mem = process.memoryUsage();
  const rssMB = (mem.rss / 1024 / 1024).toFixed(1);
  const heapMB = (mem.heapUsed / 1024 / 1024).toFixed(1);
  const heapTotalMB = (mem.heapTotal / 1024 / 1024).toFixed(1);
  
  log('info', `🧠 Memory: RSS=${rssMB}MB, HeapUsed=${heapMB}MB, HeapTotal=${heapTotalMB}MB`);
  
  // Critical memory situation
  if (parseFloat(rssMB) > 450) {
    log('error', '🚨 CRITICAL MEMORY USAGE! Force restarting client...');
    
    // Force garbage collection if available
    if (global.gc) {
      log('warn', 'Forcing garbage collection...');
      global.gc();
    }
    
    // Last resort - restart the client
    if (client) {
      (async () => {
        try {
          await client.destroy();
          client = null;
          log('warn', 'Client destroyed due to memory pressure');
          setTimeout(startClient, 5000);
        } catch (err) {
          log('error', `Failed to restart client: ${err.message}`);
        }
      })();
    }
  }
  // High memory situation
  else if (parseFloat(rssMB) > 350) {
    log('warn', '⚠️ High memory usage detected');
    if (global.gc) {
      log('info', 'Suggesting garbage collection...');
      global.gc();
    }
  }
};

// Run memory check every 5 minutes
setInterval(checkMemoryUsage, 5 * 60 * 1000);

app.get('/health', async (_, res) => {
  try {
    // Check WhatsApp client
    const clientState = client ? await client.getState() : 'NO_CLIENT';
    
    // Check Supabase connection
    let supabaseStatus = 'UNKNOWN';
    try {
      const { data, error } = await supabase.from('whatsapp_sessions').select('count(*)', { count: 'exact', head: true });
      supabaseStatus = error ? 'ERROR' : 'CONNECTED';
    } catch (err) {
      supabaseStatus = 'ERROR: ' + err.message;
    }
    
    // Get memory metrics
    const mem = process.memoryUsage();
    
    // Build health response
    const health = {
      status: clientState === 'CONNECTED' && supabaseStatus === 'CONNECTED' ? 'healthy' : 'degraded',
      version: BOT_VERSION,
      uptime: {
        seconds: Math.floor((Date.now() - startedAt) / 1000),
        readable: formatUptime(Date.now() - startedAt),
      },
      whatsapp: {
        state: clientState,
        ready: client ? true : false,
      },
      supabase: supabaseStatus,
      system: {
        memory: {
          rss: `${(mem.rss / 1024 / 1024).toFixed(1)} MB`,
          heapUsed: `${(mem.heapUsed / 1024 / 1024).toFixed(1)} MB`,
          heapTotal: `${(mem.heapTotal / 1024 / 1024).toFixed(1)} MB`,
        },
        nodejs: process.version,
      },
      timestamp: new Date().toISOString(),
    };
    
    res.status(200).json(health);
  } catch (err) {
    res.status(500).json({
      status: 'error',
      error: err.message,
      timestamp: new Date().toISOString(),
    });
  }
});

// Helper function to format uptime
function formatUptime(ms) {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  
  return `${days}d ${hours % 24}h ${minutes % 60}m ${seconds % 60}s`;
}
