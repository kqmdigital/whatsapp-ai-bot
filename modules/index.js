```javascript
// This file just re-exports all modules for cleaner imports
const { SupabaseStore } = require('./storage');
const { refreshContactData, getSenderRole } = require('./contacts');
const { handleIncomingMessage } = require('./messageHandler');
const { configureRoutes } = require('./routes');

module.exports = {
  SupabaseStore,
  refreshContactData,
  getSenderRole,
  handleIncomingMessage,
  configureRoutes
};
