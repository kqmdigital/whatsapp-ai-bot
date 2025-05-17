const axios = require('axios');
const { refreshContactData, getSenderRole } = require('./contacts');

// Store message in Supabase
async function storeMessage(supabase, messageData, log) {
  try {
    const { error } = await supabase.from('whatsapp_messages').insert({
      message_id: messageData.messageId,
      chat_id: messageData.chatId,
      chat_type: messageData.chatType,
      chat_name: messageData.chatName,
      sender_id: messageData.senderId,
      sender_name: messageData.senderName,
      sender_role: messageData.senderRole,
      content: messageData.content,
      reply_to: messageData.replyTo,
      is_from_bot: messageData.isFromBot || false,
      timestamp: messageData.timestamp
    });
    
    if (error) {
      log('error', `Failed to store message: ${error.message}`);
      return false;
    }
    return true;
  } catch (err) {
    log('error', `Exception storing message: ${err.message}`);
    return false;
  }
}

// Send message to n8n webhook
async function sendToN8nWebhook(payload, attempt = 0, log) {
  const N8N_WEBHOOK_URL = process.env.N8N_WEBHOOK_URL;
  
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
      setTimeout(() => sendToN8nWebhook(payload, attempt + 1, log), backoff);
    } else {
      log('error', 'Giving up on webhook after 5 attempts');
    }
  }
}

// Main message handler
async function handleIncomingMessage(msg, client, supabase, log) {
  try {
    // Basic message properties
    const isGroup = msg.from.endsWith('@g.us');
    const chatId = msg.from;
    const chatType = isGroup ? 'group' : 'dm';
    const senderId = msg.author || msg.from;
    const text = msg.body || '';
    const messageId = msg?.id?.id?.toString?.() || '';
    const timestamp = new Date(msg.timestamp * 1000);
    
    // Skip DMs if not enabled
    const ENABLE_DM_RESPONSES = process.env.ENABLE_DM_RESPONSES === 'true';
    if (!isGroup && !ENABLE_DM_RESPONSES) {
      log('info', '🚫 DM responses disabled. Ignoring message.');
      return;
    }
    
    // Get contact and chat info
    let senderName = 'Unknown';
    let chatName = isGroup ? 'Group Chat' : 'Direct Message';
    
    try {
      // Get contact info
      const contact = await client.getContactById(senderId);
      senderName = contact.name || contact.pushname || 'Unknown';
      
      // Get chat name if group
      if (isGroup) {
        const chat = await client.getChatById(chatId);
        chatName = chat.name || 'Group Chat';
      }
    } catch (err) {
      log('warn', `Failed to get contact/chat info: ${err.message}`);
    }
    
    // Refresh contact data from Google Sheets if needed
    await refreshContactData(log);
    
    // Determine sender role (client/employee)
    const { role: senderRole, data: senderData } = getSenderRole(senderId);
    
    // Get reply info if this is a reply
    let replyToId = null;
    try {
      const quoted = await msg.getQuotedMessage?.();
      if (quoted?.id?.id) {
        replyToId = quoted?.id?.id || null;
      }
    } catch (err) {
      log('warn', `⚠️ Failed to get quoted message: ${err.message}`);
    }
    
    // Store message in database
    const messageData = {
      messageId,
      chatId,
      chatType,
      chatName,
      senderId,
      senderName,
      senderRole,
      content: text,
      replyTo: replyToId,
      isFromBot: false,
      timestamp: timestamp.toISOString()
    };
    
    await storeMessage(supabase, messageData, log);
    
    // Prepare webhook payload
    const payload = {
      messageId,
      chatId,
      chatType,
      chatName,
      senderId,
      senderName,
      senderRole,
      phoneNumber: senderId.replace('@c.us', ''),
      text,
      hasReply: !!replyToId,
      replyTo: replyToId,
      timestamp: timestamp.toISOString(),
      contactData: senderData
    };
    
    // Send to n8n
    await sendToN8nWebhook(payload, 0, log);
    
  } catch (err) {
    log('error', `Error handling message: ${err.message}`);
  }
}

module.exports = {
  handleIncomingMessage,
  storeMessage,
  sendToN8nWebhook
};
