class SupabaseStore {
  constructor(supabaseClient, sessionId, logFunction) {
    this.supabase = supabaseClient;
    this.sessionId = sessionId;
    this.log = logFunction;
    this.log('info', `SupabaseStore initialized for session ID: ${this.sessionId}`);
  }

  async sessionExists({ session }) {
    try {
      const { count, error } = await this.supabase
        .from('whatsapp_sessions')
        .select('*', { count: 'exact', head: true })
        .eq('session_key', session);

      if (error) {
        this.log('error', `Supabase error in sessionExists: ${error.message}`);
        return false;
      }
      return count > 0;
    } catch (err) {
      this.log('error', `Exception in sessionExists: ${err.message}`);
      return false;
    }
  }

  async extract() {
    const { data, error } = await this.supabase
      .from('whatsapp_sessions')
      .select('session_data')
      .eq('session_key', this.sessionId)
      .limit(1)
      .single();

    if (error) return null;
    return data?.session_data || null;
  }

  async save(sessionData) {
    const { error } = await this.supabase
      .from('whatsapp_sessions')
      .upsert({
        session_key: this.sessionId,
        session_data: sessionData,
        updated_at: new Date().toISOString()
      }, { onConflict: 'session_key' });

    if (error) this.log('error', `Failed to save session: ${error.message}`);
  }

  async delete() {
    const { error } = await this.supabase
      .from('whatsapp_sessions')
      .delete()
      .eq('session_key', this.sessionId);

    if (error) this.log('error', `Failed to delete session: ${error.message}`);
  }
}

module.exports = { SupabaseStore };
