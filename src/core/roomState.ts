/**
 * Derives the room's visible state from viewer memory and context (design §5).
 * Pure: no DOM, no Date.now, no Math.random — the picture colour, phase and
 * local time are passed in. The renderer turns this into light and objects.
 *
 * Only the DERIVATION lives here. Sampling the picture colour (≤ 8 Hz) and
 * smoothing it over ~400 ms, and gating figure/object moves to unobserved
 * moments, are the renderer/orchestrator's job (tasks 4.2 wiring and 8); this
 * function is a pure function of the smoothed colour it is handed.
 */

import type { ViewerMemory } from './memory.ts';
import type { TvPhase } from './tvMachine.ts';

export interface RoomInput {
  memory: ViewerMemory;
  phase: TvPhase;
  /** Smoothed average picture colour, or null when off or on a YouTube item. */
  picture: { r: number; g: number; b: number } | null;
  localHour: number;
  localMinute: number;
  reduced: boolean;
}

export interface RoomState {
  /** Base room light 0..1, falls by act (requirement 5.4). */
  ambient: number;
  /** The glow the picture casts on the wall. */
  tvLight: { r: number; g: number; b: number; amount: number };
  /** Shadow-figure step: 0 absent, higher is closer (design §5). */
  figureStep: number;
  /** Which single room object has moved this visit (design §5). */
  objectVariant: number;
  /** Show earlier tears as badly repaired (requirement 4.2). */
  repairVisible: boolean;
}

/** Ambient light per act. Falls as dread rises, but never fully dark. */
const AMBIENT_BY_ACT = [0.6, 0.48, 0.36, 0.24, 0.18] as const;

/** A soft neutral light used for YouTube/off, since the player is never sampled. */
const NEUTRAL_LIGHT = { r: 70, g: 68, b: 64 };

function clampAct(act: number): number {
  return act < 0 ? 0 : act > 4 ? 4 : act;
}

/**
 * The shadow-figure step implied by act and session count (design §5). Derived
 * here so the room has a figure now; task 8 stores the applied step in memory
 * and only advances it during an unobserved moment, so a reload cannot move it.
 */
export function figureStepFor(memory: ViewerMemory): number {
  const act = clampAct(memory.act);
  // Appears at Act 1 (far edge), steps closer by act, and a returning viewer
  // (more sessions) is met one step closer still.
  const base = act <= 0 ? 0 : act; // 0..4
  const sessionBonus = memory.sessionCount >= 2 ? 1 : 0;
  return Math.min(5, base + sessionBonus);
}

/**
 * Which room object has moved (design §5): one variant, derived and stable
 * within a visit. Task 8 advances it only during an unobserved moment.
 */
export function objectVariantFor(memory: ViewerMemory): number {
  const act = clampAct(memory.act);
  // One object moves from Act 1 onward; a second from Act 3.
  if (act >= 3) return 2;
  if (act >= 1) return 1;
  return 0;
}

export function deriveRoom(input: RoomInput): RoomState {
  const { memory, phase, picture, reduced } = input;
  const act = clampAct(memory.act);
  const ambient = AMBIENT_BY_ACT[act] ?? AMBIENT_BY_ACT[4];

  let tvLight: RoomState['tvLight'];
  if (phase === 'OFF') {
    tvLight = { r: 0, g: 0, b: 0, amount: 0 };
  } else if (picture) {
    // Light from the picture's average colour (requirement 5.2). Amount scales
    // with the picture's brightness; reduced effects dims the swing so it
    // cannot flicker (requirement 8.4).
    const bright = (picture.r + picture.g + picture.b) / (3 * 255);
    const amount = (reduced ? 0.4 : 0.7) * Math.min(1, 0.3 + bright);
    tvLight = { r: picture.r, g: picture.g, b: picture.b, amount };
  } else {
    // YouTube or no owned picture: a soft neutral light, never sampled from the
    // player (requirement 5.3).
    tvLight = { ...NEUTRAL_LIGHT, amount: reduced ? 0.25 : 0.4 };
  }

  // A returning viewer (session ≥ 2) from Act 2 sees earlier tears badly
  // repaired (requirement 4.2).
  const repairVisible = memory.sessionCount >= 2 && act >= 2;

  return {
    ambient,
    tvLight,
    figureStep: figureStepFor(memory),
    objectVariant: objectVariantFor(memory),
    repairVisible,
  };
}
