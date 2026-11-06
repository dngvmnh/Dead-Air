import { describe, expect, it, beforeEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from './App.tsx';

describe('App chassis and controls', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('shows the first-run content notice before anything else', () => {
    render(<App />);
    expect(screen.getByRole('dialog', { name: /before you turn it on/i })).toBeInTheDocument();
  });

  it('cannot power on until the notice is acknowledged', async () => {
    const user = userEvent.setup();
    render(<App />);

    const power = screen.getByRole('button', { name: /power/i });
    await user.click(power);
    // Still off: the LED shows the blank display.
    expect(power).toHaveAttribute('aria-pressed', 'false');

    await user.click(screen.getByRole('button', { name: /i understand/i }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('powers on, boots, and tunes to channel 02 by default', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: /i understand/i }));
    await user.click(screen.getByRole('button', { name: /power/i }));

    const power = screen.getByRole('button', { name: /power/i });
    expect(power).toHaveAttribute('aria-pressed', 'true');

    // The ARIA live region announces the channel after boot (≤1.4s) and
    // tuning (0.5s), so allow headroom past that sequence.
    await waitFor(
      () => expect(screen.getByRole('status')).toHaveTextContent(/channel 02/i),
      { timeout: 3000 },
    );
  });

  it('surfs channels and announces the change', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: /i understand/i }));
    await user.click(screen.getByRole('button', { name: /power/i }));

    await waitFor(
      () => expect(screen.getByRole('status')).toHaveTextContent(/channel 02/i),
      { timeout: 3000 },
    );

    await user.click(screen.getByRole('button', { name: /channel up/i }));
    await waitFor(
      () => expect(screen.getByRole('status')).toHaveTextContent(/channel 04, pumpkin hour/i),
      { timeout: 3000 },
    );
  });

  it('toggles mute, captions and reduced effects via accessible controls', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: /i understand/i }));

    const cc = screen.getByRole('button', { name: /closed captions/i });
    expect(cc).toHaveAttribute('aria-pressed', 'false');
    await user.click(cc);
    expect(cc).toHaveAttribute('aria-pressed', 'true');

    const reduced = screen.getByRole('button', { name: /reduced effects/i });
    await user.click(reduced);
    expect(reduced).toHaveAttribute('aria-pressed', 'true');
  });

  it('requires a confirm tap before Forget me erases', async () => {
    const user = userEvent.setup();
    window.localStorage.setItem('deadair.memory.v1', '{"schemaVersion":1}');
    render(<App />);
    await user.click(screen.getByRole('button', { name: /i understand/i }));

    const forget = screen.getByRole('button', { name: /^forget me$/i });
    await user.click(forget);
    // Now it asks to confirm; memory is untouched.
    expect(window.localStorage.getItem('deadair.memory.v1')).not.toBeNull();

    await user.click(screen.getByRole('button', { name: /confirm forget me/i }));
    expect(window.localStorage.getItem('deadair.memory.v1')).toBeNull();
  });

  it('supports keyboard shortcuts: P powers, ArrowUp surfs', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: /i understand/i }));

    await act(async () => {
      await user.keyboard('p');
    });
    expect(screen.getByRole('button', { name: /power/i })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    await waitFor(
      () => expect(screen.getByRole('status')).toHaveTextContent(/channel 02/i),
      { timeout: 3000 },
    );

    await act(async () => {
      await user.keyboard('{ArrowUp}');
    });
    await waitFor(
      () => expect(screen.getByRole('status')).toHaveTextContent(/channel 04/i),
      { timeout: 3000 },
    );
  });

  it('makes the set inert and ignores shortcuts behind the notice', () => {
    const { container } = render(<App />);
    expect(container.querySelector('[inert]')).toContainElement(
      screen.getByRole('button', { name: /^mute$/i }),
    );

    fireEvent.keyDown(window, { key: 'm' });
    expect(screen.getByRole('button', { name: /^mute$/i })).toHaveAttribute('aria-pressed', 'false');
  });

  it('moves focus to Power when the notice closes', async () => {
    const user = userEvent.setup();
    const { container } = render(<App />);
    await user.click(screen.getByRole('button', { name: /i understand/i }));

    expect(screen.getByRole('button', { name: /^power$/i })).toHaveFocus();
    expect(container.querySelector('[inert]')).toBeNull();
  });

  it('does not toggle power or mute when a key is held down', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: /i understand/i }));

    fireEvent.keyDown(window, { key: 'p', repeat: true });
    fireEvent.keyDown(window, { key: 'm', repeat: true });

    expect(screen.getByRole('button', { name: /^power$/i })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: /^mute$/i })).toHaveAttribute('aria-pressed', 'false');
  });

  it('disables channel buttons while powered off', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: /i understand/i }));

    const controls = screen.getByRole('group', { name: /television controls/i });
    expect(within(controls).getByRole('button', { name: /channel up/i })).toBeDisabled();
  });
});
