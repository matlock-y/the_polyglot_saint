/**
 * supabaseClient.js — Supabase Client Initialization
 */
(function() {
  var SUPABASE_URL = 'https://fmdceajdaanyxwqawpgw.supabase.co';
  var SUPABASE_ANON_KEY = 'sb_publishable_TgBNQgxb2u4fX6R3cZeBZA_ArC7grRi';

  if (window.supabase && typeof window.supabase.createClient === 'function') {
    window.supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  }
})();
