# WhatsApp AI Bot

A WhatsApp bot that connects to Google Sheets for contact management and uses AI to automatically respond to messages when needed.

## Features

- **WhatsApp Integration**: Connects to WhatsApp via whatsapp-web.js
- **Google Sheets Contact Management**: Stores client and employee contacts in easily editable Google Sheets
- **Supabase Database**: Stores WhatsApp sessions and message history
- **AI Response System**: Automatically responds to client messages after a timeout period
- **Intelligent Recognition**: Identifies clients and employees based on Google Sheets data
- **Message History**: Provides conversation context to AI for better responses
- **Group & DM Support**: Handles both group chats and direct messages

## System Architecture

The system has three main components:

1. **WhatsApp Bot (This Repository)**: Handles WhatsApp connection and message processing
2. **n8n Workflows**: Manage Google Sheets integration and AI response generation
3. **Supabase Database**: Stores message history and session data

## Setup Instructions

### Prerequisites

- Node.js 18+
- Supabase Account
- n8n Instance
- Google Sheets with client and employee data

### Installation

1. Clone this repository:
git clone https://github.com/your-username/whatsapp-ai-bot.git
cd whatsapp-ai-bot

2. Install dependencies:
npm install

3. Create a `.env` file with the following variables:

PORT=3000
APP_URL=https://your-app-url.onrender.com
WHATSAPP_SESSION_ID=default_session
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key
N8N_WEBHOOK_URL=https://your-n8n.com/webhook/whatsapp
N8N_CLIENT_DATA_URL=https://your-n8n.com/webhook/clients
N8N_EMPLOYEE_DATA_URL=https://your-n8n.com/webhook/employees
ENABLE_DM_RESPONSES=false

4. Set up Supabase tables:
```sql
-- Run this SQL in your Supabase SQL editor

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
  chat_type TEXT NOT NULL,
  chat_name TEXT,
  sender_id TEXT NOT NULL,
  sender_name TEXT,
  sender_role TEXT,
  content TEXT NOT NULL,
  reply_to TEXT,
  is_from_bot BOOLEAN DEFAULT FALSE,
  timestamp TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_chat_timestamp ON whatsapp_messages (chat_id, timestamp DESC);
CREATE INDEX idx_reply_to ON whatsapp_messages (reply_to);
CREATE INDEX idx_sender_id ON whatsapp_messages (sender_id);

Running the Bot
Start the bot:
npm start
When first started, the bot will display a QR code. Scan this with WhatsApp to authenticate.
Google Sheets Setup
Create a Google Sheet with two tabs:
Clients Sheet
Columns:

Name
Phone Number
Company
Type
Notes
Last Contact
Important Info

Employees Sheet
Columns:

Name
Phone Number
Department
Role
Is Admin

n8n Workflow Setup
Import the provided n8n workflows:

Contact Sync Workflow: Reads Google Sheets data and exposes it via webhooks
AI Response Workflow: Processes incoming messages and generates AI responses

Deployment
This application is designed to be deployed on platforms like Render.
License
MIT
