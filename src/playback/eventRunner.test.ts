import { describe, expect, it } from 'vitest';
import { runEventSteps, type EventOps, type ResolvedStep } from './eventRunner.ts';

interface Recorder extends EventOps {
  calls: string[];
}

function recorder(fail?: { scene?: boolean; voice?: boolean }): Recorder {
  const calls: string[] = [];
  return {
    calls,
    showStatic: (ms, look) => {
      calls.push(`static:${ms}:${look ?? ''}`);
      return Promise.resolve();
    },
    showSlate: (text, ms) => {
      calls.push(`slate:${text}:${ms}`);
      return Promise.resolve();
    },
    playScene: (id) => {
      calls.push(`scene:${id}`);
      return fail?.scene ? Promise.reject(new Error('no scene')) : Promise.resolve();
    },
    speak: (o) => {
      calls.push(`voice:${o.caption}`);
      return fail?.voice ? Promise.reject(new Error('no media')) : Promise.resolve();
    },
    flashPrevious: (ms) => {
      calls.push(`flash:${ms}`);
      return Promise.resolve();
    },
    shaderPulse: (e, ms) => {
      calls.push(`pulse:${e}:${ms}`);
      return Promise.resolve();
    },
    silence: (ms) => {
      calls.push(`silence:${ms}`);
      return Promise.resolve();
    },
    signOff: () => {
      calls.push('signOff');
      return Promise.resolve();
    },
    captionsOverStatic: (caption, ms) => {
      calls.push(`degrade:${caption}:${ms}`);
      return Promise.resolve();
    },
    sfx: (cue, gain, ms) => {
      calls.push(`sfx:${cue}:${gain}:${ms ?? 0}`);
      return Promise.resolve();
    },
    apparition: (kind, text, ms) => {
      calls.push(`apparition:${kind}:${text ?? ''}:${ms}`);
      return Promise.resolve();
    },
    jump: (kind, ms, from) => {
      calls.push(`jump:${kind}:${ms}:${from}`);
      return Promise.resolve();
    },
    roomLights: (level, ms) => {
      calls.push(`lights:${level}:${ms}`);
      return Promise.resolve();
    },
    roomGlimpse: (ms) => {
      calls.push(`glimpse:${ms}`);
      return Promise.resolve();
    },
    cancelled: () => false,
  };
}

describe('runEventSteps', () => {
  it('runs every step in order and reports clean', async () => {
    const ops = recorder();
    const steps: ResolvedStep[] = [
      { do: 'static', ms: 500 },
      { do: 'slate', text: 'STAND BY', ms: 1000 },
      { do: 'voice', caption: 'Excuse me.' },
      { do: 'shaderPulse', effect: 'roll', ms: 300 },
      { do: 'silence', ms: 200 },
    ];
    const clean = await runEventSteps(steps, ops);
    expect(clean).toBe(true);
    expect(ops.calls).toEqual([
      'static:500:',
      'slate:STAND BY:1000',
      'voice:Excuse me.',
      'pulse:roll:300',
      'silence:200',
    ]);
  });

  it('degrades a failed voice step to its caption over static (requirement 9.6)', async () => {
    const ops = recorder({ voice: true });
    const clean = await runEventSteps([{ do: 'voice', caption: 'there you are.' }], ops);
    expect(clean).toBe(false);
    expect(ops.calls).toEqual(['voice:there you are.', 'degrade:there you are.:2500']);
  });

  it('degrades a failed scene step to static (no caption to show)', async () => {
    const ops = recorder({ scene: true });
    const clean = await runEventSteps([{ do: 'scene', sceneId: 'ghost' }], ops);
    expect(clean).toBe(false);
    // scene call, then a plain static fallback.
    expect(ops.calls[0]).toBe('scene:ghost');
    expect(ops.calls[1]).toBe('static:2500:');
  });

  it('continues after a degraded step', async () => {
    const ops = recorder({ voice: true });
    await runEventSteps(
      [
        { do: 'voice', caption: 'a' },
        { do: 'silence', ms: 50 },
      ],
      ops,
    );
    expect(ops.calls).toContain('silence:50');
  });

  it('runs the startle steps in order', async () => {
    const ops = recorder();
    await runEventSteps(
      [
        { do: 'sfx', cue: 'stinger' },
        { do: 'apparition', kind: 'gourd', ms: 1800, text: 'JUST ONE.' },
        { do: 'jump', kind: 'gourd', ms: 600 },
        { do: 'roomLights', level: 0.4, ms: 300 },
        { do: 'roomGlimpse', ms: 900 },
        { do: 'sfx', cue: 'knock', gain: 0.5, ms: 200 },
      ],
      ops,
    );
    expect(ops.calls).toEqual([
      'sfx:stinger:1:0',
      'apparition:gourd:JUST ONE.:1800',
      'jump:gourd:600:tube',
      'lights:0.4:300',
      'glimpse:900',
      'sfx:knock:0.5:200',
    ]);
  });

  it('stops early when cancelled', async () => {
    const ops = { ...recorder(), cancelled: () => true };
    const calls: string[] = [];
    ops.silence = (ms) => {
      calls.push(`silence:${ms}`);
      return Promise.resolve();
    };
    await runEventSteps([{ do: 'silence', ms: 10 }], ops);
    expect(calls).toEqual([]);
  });

  it('runs a signOff step', async () => {
    const ops = recorder();
    await runEventSteps([{ do: 'signOff' }], ops);
    expect(ops.calls).toEqual(['signOff']);
  });
});
