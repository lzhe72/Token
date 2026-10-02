import type { TokenApi } from '../shared/types';

declare global {
  interface Window {
    tokenApi: TokenApi;
  }
}

export {};
