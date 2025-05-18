// Cache for contacts
let clientContacts = new Map();
let employeeContacts = new Map();
let lastDataRefresh = 0;
const DATA_REFRESH_INTERVAL = 30 * 60 * 1000; // 30 minutes

// Function to refresh contact data from Supabase
async function refreshContactData(log) {
  const now = Date.now();
  if (now - lastDataRefresh < DATA_REFRESH_INTERVAL) {
    return;
  }

  log('info', 'Refreshing contact data from Supabase...');

  try {
    // Fetch client data from Supabase
    const { data: clients, error: clientError } = await supabase
      .from('client_contacts')
      .select('*');
      
    if (clientError) {
      log('error', `Failed to fetch clients: ${clientError.message}`);
    } else {
      // Clear and repopulate client map
      clientContacts.clear();
      
      clients.forEach(client => {
        const phoneNumber = client.phone_number;
        clientContacts.set(phoneNumber, client);
        clientContacts.set(`${phoneNumber}@c.us`, client);
      });
      
      log('info', `✅ Loaded ${clientContacts.size/2} clients from Supabase`);
    }

    // Fetch employee data from Supabase
    const { data: employees, error: employeeError } = await supabase
      .from('employee_contacts')
      .select('*');
      
    if (employeeError) {
      log('error', `Failed to fetch employees: ${employeeError.message}`);
    } else {
      // Clear and repopulate employee map
      employeeContacts.clear();
      
      employees.forEach(employee => {
        const phoneNumber = employee.phone_number;
        employeeContacts.set(phoneNumber, employee);
        employeeContacts.set(`${phoneNumber}@c.us`, employee);
      });
      
      log('info', `✅ Loaded ${employeeContacts.size/2} employees from Supabase`);
    }

    lastDataRefresh = now;
  } catch (err) {
    log('error', `Failed to refresh contact data: ${err.message}`);
  }
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

module.exports = {
  refreshContactData,
  getSenderRole,
  formatPhoneNumber,
  clientContacts,
  employeeContacts
};
