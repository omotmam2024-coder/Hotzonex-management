export type Role = 'admin' | 'manager' | 'seller';

export interface Profile {
  id: string;
  full_name: string;
  role: Role;
  site_id: string | null;
  is_active: boolean;
}

export interface Site {
  id: string;
  name: string;
}
