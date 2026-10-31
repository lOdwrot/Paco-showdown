import type { Profile } from '../net/protocol.ts';
import { sanitizeProfile } from '../net/protocol.ts';

const KEY = 'paco.profile';
const HS = 'paco.highscore';

export function loadProfile(): Profile {
  try {
    return sanitizeProfile(JSON.parse(localStorage.getItem(KEY) ?? '{}'));
  } catch {
    return sanitizeProfile({});
  }
}

export function saveProfile(p: Profile): void {
  localStorage.setItem(KEY, JSON.stringify(p));
}

export function loadHighScore(): number {
  return Number(localStorage.getItem(HS) ?? 0) || 0;
}

export function saveHighScore(v: number): void {
  if (v > loadHighScore()) localStorage.setItem(HS, String(v));
}
