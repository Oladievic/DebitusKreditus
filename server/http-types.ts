import type { User } from '../shared/types.js';

export type AppEnv = {
  Variables: { user: User; tokenAuth: boolean; sessionHash: string | null };
};
