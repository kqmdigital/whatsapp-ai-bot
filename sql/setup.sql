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
-- Client contacts table
CREATE TABLE client_contacts (
  id SERIAL PRIMARY KEY,
  phone_number TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  company TEXT,
  type TEXT,
  notes TEXT,
  last_contact TEXT,
  important_info TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Employee contacts table
CREATE TABLE employee_contacts (
  id SERIAL PRIMARY KEY,
  phone_number TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  department TEXT,
  role TEXT,
  is_admin BOOLEAN DEFAULT FALSE,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes for fast phone number lookups
CREATE INDEX idx_client_phone ON client_contacts (phone_number);
CREATE INDEX idx_employee_phone ON employee_contacts (phone_number);
-- Indexes for better performance
CREATE INDEX idx_chat_timestamp ON whatsapp_messages (chat_id, timestamp DESC);
CREATE INDEX idx_reply_to ON whatsapp_messages (reply_to);
CREATE INDEX idx_sender_id ON whatsapp_messages (sender_id);
