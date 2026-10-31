/**
 * Skin catalogue (data only – safe to import from the simulation).
 * Pixel-art accessories for each id live in src/render/sprites.ts.
 * To add a skin: add an entry here, then draw its accessory in sprites.ts
 * (see .claude/skills/add-skin/SKILL.md).
 */
export interface PacSkin {
  id: string;
  name: string;
  body: string;
  blurb: string;
}

export interface GhostSkin {
  id: string;
  name: string;
  body: string;
  blurb: string;
}

export const PAC_SKINS: readonly PacSkin[] = [
  { id: 'classic', name: 'PACO', body: '#ffe600', blurb: 'The original chomper' },
  { id: 'girl', name: 'PACO-GIRL', body: '#ffe600', blurb: 'Bow, lashes & style' },
  { id: 'president', name: 'PACO-PRESIDENT', body: '#ffe600', blurb: 'Top hat & monocle' },
  { id: 'punk', name: 'PACO-PUNK', body: '#ffe600', blurb: 'Mohawk of fury' },
  { id: 'ninja', name: 'PACO-NINJA', body: '#ffd000', blurb: 'Silent but hungry' },
  { id: 'cool', name: 'PACO-COOL', body: '#ffe600', blurb: 'Shades on, always' },
];

export const GHOST_SKINS: readonly GhostSkin[] = [
  { id: 'blaze', name: 'BLAZE', body: '#ff2020', blurb: 'Hot on your tail' },
  { id: 'bubblegum', name: 'BUBBLEGUM', body: '#ffb8ff', blurb: 'Sweet ambusher' },
  { id: 'frosty', name: 'FROSTY', body: '#00ffff', blurb: 'Cold & tricky' },
  { id: 'pumpkin', name: 'PUMPKIN', body: '#ffb852', blurb: 'Shy, then spooky' },
  { id: 'count', name: 'COUNT BOO', body: '#a040ff', blurb: 'Vampire cape' },
  { id: 'sirspook', name: 'SIR SPOOK', body: '#30d050', blurb: 'Top hat gentleman' },
  { id: 'pirate', name: 'GHOSTBEARD', body: '#8090b0', blurb: 'Arr, eyepatch' },
  { id: 'wisp', name: 'LADY WISP', body: '#f0f0ff', blurb: 'Elegant & eerie' },
];

/** Default ghost skin per slot for AI ghosts. */
export const DEFAULT_GHOST_SKINS = ['blaze', 'bubblegum', 'frosty', 'pumpkin'] as const;

export function pacSkin(id: string): PacSkin {
  return PAC_SKINS.find((s) => s.id === id) ?? PAC_SKINS[0]!;
}

export function ghostSkin(id: string): GhostSkin {
  return GHOST_SKINS.find((s) => s.id === id) ?? GHOST_SKINS[0]!;
}

/** Assigns a skin per ghost slot: humans use their choice; AI fill with unused defaults. */
export function assignGhostSkins(owners: (string | null)[], chosen: Map<string, string>): string[] {
  const used = new Set<string>();
  owners.forEach((o) => o && used.add(chosen.get(o) ?? 'blaze'));
  const pool = [...DEFAULT_GHOST_SKINS, ...GHOST_SKINS.map((s) => s.id)].filter((id, i, a) => a.indexOf(id) === i);
  return owners.map((o, slot) => {
    if (o) return chosen.get(o) ?? DEFAULT_GHOST_SKINS[slot]!;
    const pref = DEFAULT_GHOST_SKINS[slot]!;
    if (!used.has(pref)) {
      used.add(pref);
      return pref;
    }
    const free = pool.find((id) => !used.has(id)) ?? pref;
    used.add(free);
    return free;
  });
}
