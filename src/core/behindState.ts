/**
 * What is behind the wall for this viewer right now (design §4, requirement 3).
 * Pure: memory and local-time context in, a plain description out. Text comes
 * only from real values through `core/template`; a line with no real value is
 * left out, so the wall never invents a fact about the viewer.
 */

import type { ViewerMemory } from './memory.ts';
import { fillTemplate, type TemplateContext } from './template.ts';
import { CHANNEL_CYCLE } from './types.ts';

export interface BehindView {
  act: number;
  /** Pencil marks: the viewer's real number of channel visits. */
  tally: number;
  /** Words scratched into the plaster. Empty when there is nothing real to say. */
  lines: string[];
  /** Changes only when the picture would, so the layer is baked only then. */
  key: string;
}

/** Scratched lines, in the order they appear. */
const SCRATCHED_LINES = ['CHANNELS {visitedList}', 'FIRST WATCHED {firstViewing}'] as const;

export function deriveBehind(memory: ViewerMemory, ctx: TemplateContext): BehindView {
  const act = memory.act;
  const tally = act === 1 ? CHANNEL_CYCLE.reduce((sum, id) => sum + memory.channels[id].visits, 0) : 0;
  const lines: string[] = [];
  if (act === 2) {
    for (const template of SCRATCHED_LINES) {
      const { text, missing } = fillTemplate(template, memory, ctx);
      if (missing.length === 0) lines.push(text);
    }
  }
  return { act, tally, lines, key: `${act}|${tally}|${lines.join('|')}` };
}
