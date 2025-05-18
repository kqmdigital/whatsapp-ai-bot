// This file just re-exports all modules for cleaner imports
const { SupabaseStore } = require('./storage');
const { initializeContacts, isClient, isEmployee, refreshContacts, getContactDetails } = require('./contacts');
const { handleIncomingMessage } = require('./messageHandler');
const { configureRoutes } = require('./routes');

module.exports = {
  SupabaseStore,
  initializeContacts,
  isClient, 
  isEmployee,
  refreshContacts,
  getContactDetails,
  handleIncomingMessage,
  configureRoutes
};
