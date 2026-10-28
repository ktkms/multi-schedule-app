import 'server-only';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from './database.types';

// Environment variables
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
// Create the Supabase admin client with service role key (for server operations only)
export const createSupabaseAdmin = (): SupabaseClient<Database> => {
  if (!supabaseUrl || !supabaseServiceKey) {
    throw new Error('Supabase credentials not available. Check environment variables.');
  }
  return createClient<Database>(supabaseUrl, supabaseServiceKey, {
    auth: {
      persistSession: false, // Don't persist auth state for server usage
      autoRefreshToken: false, // Don't try to refresh tokens for server usage
    },
  });
};

/**
 * 旧来の公開フロー向けサーバー専用クライアント。
 * 匿名キーによるDB直接アクセスを廃止し、サーバー内でのみservice_roleを使う。
 * 呼び出し元との互換性のため関数名は維持する。
 */
export const createSupabaseClient = (): SupabaseClient<Database> => createSupabaseAdmin();
