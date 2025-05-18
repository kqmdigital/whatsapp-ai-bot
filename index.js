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
const ENABLE_DM_RESPONSES = process.env.ENABLE_DM_RESPONSES === 'true';

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
  console[level === 'debug' ? 'log' : level](formatted, ...args);
};

// Initialize storage
const supabaseStore = new SupabaseStore(supabase, SESSION_ID, log);

// Initialize WhatsApp client
let client = null;

// Helper to store message in Supabase
async function storeMessage(msg, chat, senderRole = 'unknown', isFromBot = false) {
  try {
    const chatType = chat.isGroup ? 'group' : 'dm';
    const chatName = chat.name || (chat.isGroup ? 'Unknown Group' : 'Private Chat');
    
    // Get sender info if available
    let senderName = 'Unknown';
    try {
      if (!isFromBot) {
        const contact = await msg.getContact();
        senderName = contact.pushname || contact.name || 'Unknown';
      } else {
        senderName = 'Bot';
      }
    } catch (err) {
      log('error', `Failed to get contact info: ${err.message}`);
    }
    
    // Prepare message data
    const messageData = {
      message_id: msg.id._serialized,
      chat_id: chat.id._serialized,
      chat_type: chatType,
      chat_name: chatName,
      sender_id: isFromBot ? 'bot' : msg.from,
      sender_name: senderName,
      sender_role: isFromBot ? 'bot' : senderRole,
      content: msg.body,
      reply_to: msg.quotedMsgId?._serialized || null,
      is_from_bot: isFromBot,
      timestamp: new Date(msg.timestamp * 1000)
    };
    
    // Insert into Supabase
    const { data, error } = await supabase
      .from('whatsapp_messages')
      .insert(messageData)
      .select();
    
    if (error) {
      log('error', `Failed to store message: ${error.message}`);
      return null;
    }
    
    log('debug', `✅ Message stored in database: ${msg.id._serialized}`);
    return data[0];
  } catch (err) {
    log('error', `Error storing message: ${err.message}`);
    return null;
  }
}

// Helper to trigger n8n webhook
async function triggerN8nWebhook(msg, chat, senderInfo, storedMessage) {
  if (!N8N_WEBHOOK_URL) return;
  
  try {
    // Prepare data for n8n
    const webhookData = {
      messageId: msg.id._serialized,
      chatId: chat.id._serialized,
      from: msg.from,
      body: msg.body,
      timestamp: msg.timestamp,
      timestampISO: new Date(msg.timestamp * 1000).toISOString(),
      isGroup: chat.isGroup,
      chatName: chat.name,
      chatType: chat.isGroup ? 'group'
