const SUPABASE_URL = 'https://sienbzdpraepdbffkzgk.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNpZW5iemRwcmFlcGRiZmZremdrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE3NDU4MTEsImV4cCI6MjA5NzMyMTgxMX0.rWIudaEg-FPPaw7TebF7m4OLQLTqx_QBgsBiG4OCFRg';

// CDN 로드 실패로 전역 supabase가 없을 수 있어 try/catch로 감쌉니다.
// (main.js의 폴백 데이터가 정상 동작하려면 여기서 예외가 새어나가면 안 됩니다.)
let supabaseClient = null;
try {
  supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
} catch (err) {
  console.error('Supabase 클라이언트를 초기화하지 못했습니다.', err);
}
