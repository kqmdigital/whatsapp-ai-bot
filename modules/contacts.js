const axios = require('axios');

// Cache for contacts
let clientContacts = new Map();
let employeeContacts = new Map();
let lastDataRefresh = 0;
const DATA_REFRESH_INTERVAL = 30 * 60 * 1000; // 30 minutes

// Function to refresh contact data from Google Sheets via n8n
async function refreshContactData(log) {
  const now = Date.now();
  if (now - lastDataRefresh < DATA_REFRESH_INTERVAL) {
    return;
  }

  log('info', 'Refreshing contact data from Google Sheets...');

  try {
    // Fetch client data
    const clientResponse = await axios.get(process.env.N8N_CLIENT_DATA_URL, { timeout: 10000 });
    if (clientResponse.data && Array.isArray(clientResponse.data.clients)) {
      // Clear and repopulate client map
      clientContacts.clear();
      
      clientResponse.data.clients.forEach(client => {
        if (client.phone) {
          const phoneNumber = formatPhoneNumber(client.phone);
          clientContacts.set(phoneNumber, client);
          clientContacts.set(`${phoneNumber}@c.us`, client);
        }
      });
      
      log('info', `✅ Loaded ${clientContacts.size/2} clients from Google Sheets`);
    }

    // Fetch employee data
    const employeeResponse = await axios.get(process.env.N8N_EMPLOYEE_DATA_URL, { timeout: 10000 });
    if (employeeResponse.data && Array.isArray(employeeResponse.data.employees)) {
      // Clear and repopulate employee map
      employeeContacts.clear();
      
      employeeResponse.data.employees.forEach(employee => {
        if (employee.phone) {
          const phoneNumber = formatPhoneNumber(employee.phone);
          employeeContacts.set(phoneNumber, employee);
          employeeContacts.set(`${phoneNumber}@c.us`, employee);
        }
      });
      
      log('info', `✅ Loaded ${employeeContacts.size/2} employees from Google Sheets`);
    }

    lastDataRefresh = now;
  } catch (err) {
    log('error', `Failed to refresh contact data: ${err.message}`);
  }
}

// Helper to standardize phone number format
function formatPhoneNumber(phone) {
  // Strip all non-numeric characters
  let cleaned = ('' + phone).replace(/\D/g, '');
  
  // Ensure it starts with country code (default to 65 for Singapore)
  if (cleaned.length === 8) {
    cleaned = '65' + cleaned; // Add Singapore country code
  } else if (cleaned.length === 10 && cleaned.startsWith('0')) {
    // For numbers like 0812345678, assume it's missing country code
    cleaned = '65' + cleaned.substring(1);
  }
  
  return cleaned;
}

// Helper to check if sender is client or employee
function getSenderRole(senderId) {
  const normalizedId = senderId.includes('@c.us') ? senderId : `${senderId}@c.us`;
  const cleanPhone = senderId.replace('@c.us', '');
  
  if (clientContacts.has(normalizedId) || clientContacts.has(cleanPhone)) {
    return {
      role: 'client',
      data: clientContacts.get(normalizedId) || clientContacts.get(cleanPhone)
    };
  }
  
  if (employeeContacts.has(normalizedId) || employeeContacts.has(cleanPhone)) {
    return {
      role: 'employee',
      data: employeeContacts.get(normalizedId) || employeeContacts.get(cleanPhone)
    };
  }
  
  return { role: 'unknown', data: null };
}

module.exports = {
  refreshContactData,
  getSenderRole,
  formatPhoneNumber,
  clientContacts,
  employeeContacts
};
