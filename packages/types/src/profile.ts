export interface ProfileBase {
  id: string;
  name: string;
  is_active: boolean;
  server_count?: number;
  created_at: string;
  updated_at: string;
}
