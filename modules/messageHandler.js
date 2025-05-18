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
    
    // REMOVED: Don't call sendToN8nWebhook here since triggerAIResponse will do it
    
    // Return the message data for potential use by caller
    return {
      messageId,
      chatId,
      chatType,
      chatName,
      senderId,
      senderName,
      senderRole,
      text,
      timestamp,
      senderData
    };
  } catch (err) {
    log('error', `Error handling message: ${err.message}`);
    return null;
  }
}
