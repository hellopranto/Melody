export type AuthUser = {
  id: number;
  email: string;
  display_name: string;
  role: 'user' | 'admin';
  status: 'active' | 'disabled';
};
