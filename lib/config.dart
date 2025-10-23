
class AppConfig {
  static const String supabaseUrl = String.fromEnvironment('SUPABASE_URL', defaultValue: 'https://wlrukpxzyqrjepovabei.supabase.co');
  static const String supabaseAnonKey = String.fromEnvironment('SUPABASE_ANON_KEY', defaultValue: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndscnVrcHh6eXFyamVwb3ZhYmVpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTkwNzM0MjgsImV4cCI6MjA3NDY0OTQyOH0.nuwcFPs2sXDCpjuIetFO1l__ZVdMD5PuJfm81s_JSCw');
}
