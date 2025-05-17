-- WhatsApp session storage
CREATE TABLE whatsapp_sessions (
  session_key TEXT PRIMARY KEY,
  session_data JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Message history
CREATE TABLE whatsapp_messages (
  id SERIAL PRIMARY KEY,
  message_id TEXT UNIQUE NOT NULL,
  chat_id TEXT NOT NULL,
  chat_type TEXT NOT NULL,                -- 'group' or 'dm'
  chat_name TEXT,                         -- Group name or contact name
  sender_id TEXT NOT NULL,
  sender_name TEXT,
  sender_role TEXT,                       -- 'client', 'employee', 'bot', 'unknown'
  content TEXT NOT NULL,
  reply_to TEXT,                          -- ID of message being replied to, if any
  is_from_bot BOOLEAN DEFAULT FALSE,
  timestamp TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for better performance
CREATE INDEX idx_chat_timestamp ON whatsapp_messages (chat_id, timestamp DESC);
CREATE INDEX idx_reply_to ON whatsapp_messages (reply_to);
CREATE INDEX idx_sender_id ON whatsapp_messages (sender_id);
