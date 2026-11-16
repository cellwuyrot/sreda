// This path replaces the obsolete test for the removed welcome background video.
// Keep it in the full archive so an archive copied over an older git checkout
// cannot leave the obsolete test behind. The current scenes use this visibility guard.
import { render, cleanup, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { IdleAnimationGuard } from '@/components/IdleAnimationGuard';
import { isVisualHidden, VISUAL_VISIBILITY_EVENT } from '@/lib/visualVisibility';

vi.mock('@/lib/desktop', () => ({ getDesktopApi: () => null }));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  document.documentElement.removeAttribute('data-tz-idle');
});

describe('welcome scene visibility', () => {
  it('pauses visual work while the document is hidden and resumes when visible', async () => {
    let hidden = false;
    vi.spyOn(document, 'hidden', 'get').mockImplementation(() => hidden);
    const onVisibility = vi.fn();
    document.addEventListener(VISUAL_VISIBILITY_EVENT, onVisibility);
    try {
      const view = render(<IdleAnimationGuard />);
      expect(isVisualHidden()).toBe(false);
      hidden = true;
      document.dispatchEvent(new Event('visibilitychange'));
      await waitFor(() => expect(isVisualHidden()).toBe(true));
      hidden = false;
      document.dispatchEvent(new Event('visibilitychange'));
      await waitFor(() => expect(isVisualHidden()).toBe(false));
      expect(onVisibility).toHaveBeenCalledTimes(2);
      view.unmount();
      expect(document.documentElement.hasAttribute('data-tz-idle')).toBe(false);
    } finally {
      document.removeEventListener(VISUAL_VISIBILITY_EVENT, onVisibility);
    }
  });
});
