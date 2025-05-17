const { storeMessage } = require('./messageHandler');

function configureRoutes(app, client, supabase, log) {
  // Health check endpoint
  app.get('/', (_, res) => {
    res.status(200).json({
      status: '✅ Bot running',
      version: process.env.BOT_VERSION || '1.1.0',
      uptimeMinutes: Math.floor((Date.now() - global.startedAt) / 60000),
      timestamp: new Date().toISOString(),
    });
  });

  // Simple ping endpoint for keep-alive
  app.get('/ping', (_, res) => {
    res.status(200).send('pong');
  });

  // Detailed health check
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
        version: process.env.BOT_VERSION || '1.1.0',
        uptime: {
          seconds: Math.floor((Date.now() - global.startedAt) / 1000),
          readable: formatUptime(Date.now() - global.startedAt),
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

  // Send message endpoint
  app.post('/send-message', async (req, res) => {
    const { chatId, message, replyTo } = req.body;

    if (!chatId || !message) {
      return res.status(400).json({ success: false, error: 'Missing chatId or message' });
    }

    if (!client) {
      return res.status(503).json({ success: false, error: 'WhatsApp client not ready' });
    }

    try {
      // Determine if this is a group chat
      const isGroup = chatId.includes('@g.us');
      const formattedChatId = isGroup ? 
        (chatId.endsWith('@g.us') ? chatId : `${chatId}@g.us`) : 
        (chatId.endsWith('@c.us') ? chatId : `${chatId}@c.us`);
      
      // Create message options
      const messageOptions = {};
      if (replyTo) {
        messageOptions.quotedMessageId = replyTo;
      }
      
      // Send the message
      const sentMessage = await client.sendMessage(formattedChatId, message, messageOptions);
      
      // Get chat info for storage
      let chatName = isGroup ? 'Group Chat' : 'Direct Message';
      try {
        const chat = await client.getChatById(formattedChatId);
        chatName = chat.name || chatName;
      } catch (err) {
        log('warn', `Could not get chat info for storage: ${err.message}`);
      }
      
      // Store the bot message in database
      if (sentMessage && sentMessage.id) {
        const messageData = {
          messageId: sentMessage.id.id,
          chatId: formattedChatId,
          chatType: isGroup ? 'group' : 'dm',
          chatName: chatName,
          senderId: 'bot@system.gus',
          senderName: 'AI Assistant',
          senderRole: 'bot',
          content: message,
          replyTo: replyTo || null,
          isFromBot: true,
          timestamp: new Date().toISOString()
        };
        
        await storeMessage(supabase, messageData, log);
      }
      
      return res.status(200).json({ 
        success: true, 
        messageId: sentMessage.id.id,
        timestamp: new Date().toISOString()
      });
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  // Check if a message has been replied to
  app.get('/message-status/:messageId', async (req, res) => {
    try {
      const { messageId } = req.params;
      
      // Query database to find replies
      const { data, error, count } = await supabase
        .from('whatsapp_messages')
        .select('*', { count: 'exact' })
        .eq('reply_to', messageId);
        
      if (error) {
        return res.status(500).json({ success: false, error: error.message });
      }
      
      return res.status(200).json({
        success: true,
        messageId,
        hasReplies: (count > 0),
        repliesCount: count,
        replies: data || []
      });

    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  // Get chat history
  app.get('/chat-history/:chatId', async (req, res) => {
    try {
      const { chatId } = req.params;
      const limit = parseInt(req.query.limit || '20');
      
      // Get recent messages
      const { data: messages, error } = await supabase
        .from('whatsapp_messages')
        .select('*')
        .eq('chat_id', chatId)
        .order('timestamp', { ascending: false })
        .limit(limit);
        
      if (error) {
        return res.status(500).json({ success: false, error: error.message });
      }
      
      return res.status(200).json({
        success: true,
        chatId,
        messages: messages.reverse() // Return in chronological order
      });
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
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
}

module.exports = { configureRoutes };
