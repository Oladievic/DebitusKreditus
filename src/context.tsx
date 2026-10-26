import { createContext, useContext } from 'react';
import type { AuthResponse, Preferences } from '../shared/types';
import type { PreferencesPersistenceStatus } from './preferences';

export const AuthContext = createContext<{
  auth: AuthResponse;
  refreshAuth: () => Promise<void>;
  logout: () => Promise<void>;
  preferences: Preferences;
  updatePreferences: (patch: Partial<Preferences>) => void;
  persistenceStatus: PreferencesPersistenceStatus;
  preferencesError: string;
  retryPreferences: () => void;
  toast: (message: string) => void;
}>(null!);
export const useAuth = () => useContext(AuthContext);
