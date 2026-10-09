/** Schema-defined until local generation is available. See supabase/README.md.
 * Regenerate with Supabase CLI after applying the local migrations.
 * Database types describe storage; PostgreSQL grants/RLS control API privileges.
 */
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];
export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: { user_id: string; display_name: string | null; created_at: string; updated_at: string };
        Insert: { user_id: string; display_name?: string | null; created_at?: string; updated_at?: string };
        Update: { user_id?: string; display_name?: string | null; created_at?: string; updated_at?: string };
        Relationships: [];
      };
      staff_accounts: {
        Row: { user_id: string; role: Database['public']['Enums']['staff_role']; author_slug: string | null; created_at: string };
        Insert: { user_id: string; role: Database['public']['Enums']['staff_role']; author_slug?: string | null; created_at?: string };
        Update: { user_id?: string; role?: Database['public']['Enums']['staff_role']; author_slug?: string | null; created_at?: string };
        Relationships: [];
      };
    };
    Views: { [_ in never]: never };
    Functions: { [_ in never]: never };
    Enums: { staff_role: 'author' | 'admin' };
    CompositeTypes: { [_ in never]: never };
  };
};
