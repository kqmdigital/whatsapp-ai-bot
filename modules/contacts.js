// modules/contacts.js - FIXED VERSION

// The supabase import is missing or incorrect
// Replace this line:
// const { supabase } = require('./storage');

// With this line that takes supabase as a parameter:
let supabaseClient;

// Cache for contacts
const clientContacts = new Map();
const employeeContacts = new Map();
let lastDataRefresh = 0;
const DATA_REFRESH_INTERVAL = 30 * 60 * 1000; // 30 minutes

// Function to initialize the module with the Supabase client
function initializeContactsModule(supabase) {
  supabaseClient = supabase;
}

// Function to refresh contact data from Supabase
async function refreshContactData(log = console.log) {
  if (!supabaseClient) {
    log('error', 'Supabase client not initialized. Call initializeContactsModule first.');
    return null;
  }

  const now = Date.now();
  if (now - lastDataRefresh < DATA_REFRESH_INTERVAL) {
    return { clientCount: clientContacts.size/2, employeeCount: employeeContacts.size/2 };
  }
  
  log('info', 'Refreshing contact data from Supabase...');
  try {
    // Fetch client data from Supabase
    const { data: clients, error: clientError } = await supabaseClient
      .from('client_contacts')
      .select('*');
      
    if (clientError) {
      log('error', `Failed to fetch clients: ${clientError.message}`);
    } else {
      // Clear and repopulate client map
      clientContacts.clear();
      
      clients.forEach(client => {
        const phoneNumber = client.phone_number;
        if (phoneNumber) {
          clientContacts.set(phoneNumber, client);
          clientContacts.set(`${phoneNumber}@c.us`, client);
        }
      });
      
      log('info', `✅ Loaded ${clientContacts.size/2} clients from Supabase`);
    }
    
    // Fetch employee data from Supabase
    const { data: employees, error: employeeError } = await supabaseClient
      .from('employee_contacts')
      .select('*');
      
    if (employeeError) {
      log('error', `Failed to fetch employees: ${employeeError.message}`);
    } else {
      // Clear and repopulate employee map
      employeeContacts.clear();
      
      employees.forEach(employee => {
        const phoneNumber = employee.phone_number;
        if (phoneNumber) {
          employeeContacts.set(phoneNumber, employee);
          employeeContacts.set(`${phoneNumber}@c.us`, employee);
        }
      });
      
      log('info', `✅ Loaded ${employeeContacts.size/2} employees from Supabase`);
    }
    
    lastDataRefresh = now;
    return { 
      clientCount: clientContacts.size/2, 
      employeeCount: employeeContacts.size/2 
    };
  } catch (err) {
    log('error', `Failed to refresh contact data: ${err.message}`);
    throw err;
  }
}

// Helper to check if sender is client or employee
function getSenderRole(senderId) {
  if (!senderId) {
    return { role: 'unknown', data: null };
  }
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

// Function to check if a phone number belongs to a client
function isClient(phoneNumber) {
  if (!phoneNumber) return false;
  
  const normalizedId = phoneNumber.includes('@c.us') ? phoneNumber : `${phoneNumber}@c.us`;
  const cleanPhone = phoneNumber.replace('@c.us', '');
  return clientContacts.has(normalizedId) || clientContacts.has(cleanPhone);
}

// Function to check if a phone number belongs to an employee
function isEmployee(phoneNumber) {
  if (!phoneNumber) return false;
  
  const normalizedId = phoneNumber.includes('@c.us') ? phoneNumber : `${phoneNumber}@c.us`;
  const cleanPhone = phoneNumber.replace('@c.us', '');
  return employeeContacts.has(normalizedId) || employeeContacts.has(cleanPhone);
}

// Helper to standardize phone number format
function formatPhoneNumber(phone) {
  if (!phone) return '';
  
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

// Function to get contact details
function getContactDetails(phoneNumber) {
  if (!phoneNumber) return null;
  
  const normalizedId = phoneNumber.includes('@c.us') ? phoneNumber : `${phoneNumber}@c.us`;
  const cleanPhone = phoneNumber.replace('@c.us', '');
  
  if (clientContacts.has(normalizedId) || clientContacts.has(cleanPhone)) {
    const data = clientContacts.get(normalizedId) || clientContacts.get(cleanPhone);
    return { ...data, type: 'client' };
  }
  
  if (employeeContacts.has(normalizedId) || employeeContacts.has(cleanPhone)) {
    const data = employeeContacts.get(normalizedId) || employeeContacts.get(cleanPhone);
    return { ...data, type: 'employee' };
  }
  
  return null;
}

// Export functions but NOT the Maps directly
module.exports = {
  initializeContactsModule,
  refreshContactData,
  getSenderRole,
  formatPhoneNumber,
  isClient,
  isEmployee,
  getContactDetails
};
