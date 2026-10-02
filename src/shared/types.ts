export type Role = 'admin' | 'viewer';

export interface PublicUser {
  id: string;
  username: string;
  role: Role;
  active: boolean;
  createdAt: string;
}

export interface AppState {
  needsSetup: boolean;
  user: PublicUser | null;
}

export interface TokenApi {
  getState(): Promise<AppState>;
  setupAdmin(username: string, password: string): Promise<PublicUser>;
  login(username: string, password: string): Promise<PublicUser>;
  logout(): Promise<void>;
  listUsers(): Promise<PublicUser[]>;
  createUser(username: string, password: string, role: Role): Promise<PublicUser>;
  setUserActive(userId: string, active: boolean): Promise<void>;
  changePassword(userId: string, password: string): Promise<void>;
}
