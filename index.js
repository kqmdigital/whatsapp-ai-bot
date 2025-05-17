const fs = require('fs');
const path = require('path');
const { Client, RemoteAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const express = require('express');
const axios = require('axios');
const { createClient } = require('@supabase/supabase-js');

// Import modules
const { SupabaseStore } = require('./modules/storage');
const { refreshContactData, getSenderRole } = require('./modules/contacts');
const { handleIncomingMessage } = require('./modules/messageHandler');
const { configureRoutes } = require('./modules/routes');

// Environment variables
const PORT = process.env.PORT || 3000;
const SESSION_ID = process.env.WHATSAPP_SESSION_ID || 'default_session';
const BOT_VERSION = '1.1.0';
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const N8N_WEBHOOK_URL = process.env.N8N_WEBHOOK_URL;

// Record start time for uptime tracking
global.startedAt = Date.now();

// Validate required environment variables
if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error('❌ Missing Supabase credentials. Exiting.');
  process.exit(1);
}

// Initialize Supabase client
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Configure logging
const log = (level, message, ...args) => {
  const timestamp = new Date().toISOString();
  const formatted = `[${timestamp}] [${level.toUpperCase()}] [${SESSION_ID}] ${message}`;
  console[level](formatted, ...args);
};

// Initialize storage
const supabaseStore = new SupabaseStore(supabase, SESSION_ID, log);

// Initialize WhatsApp client
let client = null;

function createWhatsAppClient() {
  try {
    // Ensure auth folder exists
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
          '--js-flags=--max-old-space-size=256',
          '--disable-extensions',
        ],
        timeout: 120000,
      },
      qrTimeout: 90000,
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

  c.on('message', msg => handleIncomingMessage(msg, client, supabase, log));
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

// Initialize Express app
const app = express();
app.use(express.json());

// Configure routes
configureRoutes(app, client, supabase, log);

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

// Start the server
const server = app.listen(PORT, () => {
  log('info', `🚀 Server started on http://localhost:${PORT}`);
  log('info', `🤖 Bot Version: ${BOT_VERSION}`);
  log('info', '💻 Starting WhatsApp client in 3 seconds...');
  
  // Slight delay to ensure server is fully up
  setTimeout(startClient, 3000);
});

// Watchdog for client state
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

// Memory monitoring
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

// Self-ping to keep alive
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

// Track external pings
app.use((req, res, next) => {
  if (req.path === '/ping') {
    lastPingSent = Date.now();
  }
  next();
});

// Run self-ping every 4 minutes
setInterval(selfPing, 4 * 60 * 1000);
