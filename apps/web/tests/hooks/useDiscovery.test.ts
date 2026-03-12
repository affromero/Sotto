import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useDiscovery } from '@/lib/hooks/useDiscovery';

class MockReadableStream {
  private chunks: Uint8Array[];
  private index = 0;

  constructor(chunks: string[]) {
    const encoder = new TextEncoder();
    this.chunks = chunks.map((chunk) => encoder.encode(chunk));
  }

  getReader() {
    return {
      read: async () => {
        if (this.index >= this.chunks.length) {
          return { done: true, value: undefined };
        }
        return { done: false, value: this.chunks[this.index++] };
      },
    };
  }
}

beforeEach(() => {
  global.fetch = vi.fn();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('useDiscovery', () => {
  describe('initial state', () => {
    it('starts with empty messages array', () => {
      const { result } = renderHook(() => useDiscovery());
      expect(result.current.messages).toEqual([]);
    });

    it('starts with null metadata', () => {
      const { result } = renderHook(() => useDiscovery());
      expect(result.current.metadata).toBeNull();
    });

    it('starts with isLoading false', () => {
      const { result } = renderHook(() => useDiscovery());
      expect(result.current.isLoading).toBe(false);
    });

    it('starts with isComplete false', () => {
      const { result } = renderHook(() => useDiscovery());
      expect(result.current.isComplete).toBe(false);
    });
  });

  describe('sendMessage', () => {
    it('adds user message immediately', async () => {
      vi.mocked(fetch).mockImplementation(() => new Promise(() => {}));

      const { result } = renderHook(() => useDiscovery());

      act(() => {
        result.current.sendMessage('Hello');
      });

      expect(result.current.messages).toHaveLength(2);
      expect(result.current.messages[0].role).toBe('user');
      expect(result.current.messages[0].content).toBe('Hello');
      expect(result.current.messages[1].role).toBe('assistant');
      expect(result.current.messages[1].content).toBe('');
    });

    it('sets isLoading to true during request', async () => {
      vi.mocked(fetch).mockImplementation(() => new Promise(() => {}));

      const { result } = renderHook(() => useDiscovery());

      act(() => {
        result.current.sendMessage('Test');
      });

      expect(result.current.isLoading).toBe(true);
    });

    it('streams content chunks into assistant message', async () => {
      const chunks = [
        'data: {"type":"content","content":"Hello"}\n',
        'data: {"type":"content","content":" world"}\n',
        'data: [DONE]\n',
      ];

      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        body: new MockReadableStream(chunks),
      } as unknown as Response);

      const { result } = renderHook(() => useDiscovery());

      await act(async () => {
        await result.current.sendMessage('Test');
      });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.messages).toHaveLength(2);
      expect(result.current.messages[1].content).toBe('Hello world');
    });

    it('updates chips when received', async () => {
      const chunks = [
        'data: {"type":"content","content":"What topic?"}\n',
        'data: {"type":"chips","chips":["Quantum Computing","AI Ethics","Climate Science"]}\n',
        'data: [DONE]\n',
      ];

      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        body: new MockReadableStream(chunks),
      } as unknown as Response);

      const { result } = renderHook(() => useDiscovery());

      await act(async () => {
        await result.current.sendMessage('Suggest topics');
      });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.messages[1].chips).toEqual([
        'Quantum Computing',
        'AI Ethics',
        'Climate Science',
      ]);
    });

    it('updates metadata when received', async () => {
      const chunks = [
        'data: {"type":"metadata","metadata":{"topic":"Quantum Physics","depth":"deep"}}\n',
        'data: [DONE]\n',
      ];

      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        body: new MockReadableStream(chunks),
      } as unknown as Response);

      const { result } = renderHook(() => useDiscovery());

      await act(async () => {
        await result.current.sendMessage('Quantum Physics');
      });

      await waitFor(() => {
        expect(result.current.metadata).not.toBeNull();
      });

      expect(result.current.metadata?.topic).toBe('Quantum Physics');
      expect(result.current.metadata?.depth).toBe('deep');
    });

    it('merges multiple metadata updates', async () => {
      const chunks = [
        'data: {"type":"metadata","metadata":{"topic":"AI"}}\n',
        'data: {"type":"metadata","metadata":{"depth":"standard"}}\n',
        'data: {"type":"metadata","metadata":{"audienceLevel":"beginner"}}\n',
        'data: [DONE]\n',
      ];

      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        body: new MockReadableStream(chunks),
      } as unknown as Response);

      const { result } = renderHook(() => useDiscovery());

      await act(async () => {
        await result.current.sendMessage('AI for beginners');
      });

      await waitFor(() => {
        expect(result.current.metadata).not.toBeNull();
      });

      expect(result.current.metadata?.topic).toBe('AI');
      expect(result.current.metadata?.depth).toBe('standard');
      expect(result.current.metadata?.audienceLevel).toBe('beginner');
    });

    it('sets isComplete when metadata.ready is true', async () => {
      const chunks = ['data: {"type":"metadata","metadata":{"ready":true}}\n', 'data: [DONE]\n'];

      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        body: new MockReadableStream(chunks),
      } as unknown as Response);

      const { result } = renderHook(() => useDiscovery());

      await act(async () => {
        await result.current.sendMessage('Generate');
      });

      await waitFor(() => {
        expect(result.current.isComplete).toBe(true);
      });
    });

    it('includes podcastId in request when provided', async () => {
      const chunks = ['data: [DONE]\n'];

      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        body: new MockReadableStream(chunks),
      } as unknown as Response);

      const { result } = renderHook(() => useDiscovery());

      await act(async () => {
        await result.current.sendMessage('Update', 'podcast-123');
      });

      expect(fetch).toHaveBeenCalledWith(
        '/api/discovery',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: 'Update', history: [], podcastId: 'podcast-123' }),
        })
      );
    });

    it('handles malformed JSON gracefully', async () => {
      const chunks = [
        'data: {"type":"content","content":"Valid"}\n',
        'data: {invalid-json}\n',
        'data: {"type":"content","content":" message"}\n',
        'data: [DONE]\n',
      ];

      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        body: new MockReadableStream(chunks),
      } as unknown as Response);

      const { result } = renderHook(() => useDiscovery());

      await act(async () => {
        await result.current.sendMessage('Test');
      });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.messages[1].content).toBe('Valid message');
    });

    it('handles partial chunks across buffer boundaries', async () => {
      const chunks = ['data: {"type":"con', 'tent","content":"Split"}\n', 'data: [DONE]\n'];

      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        body: new MockReadableStream(chunks),
      } as unknown as Response);

      const { result } = renderHook(() => useDiscovery());

      await act(async () => {
        await result.current.sendMessage('Test');
      });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.messages[1].content).toBe('Split');
    });

    it('removes assistant message on error', async () => {
      vi.mocked(fetch).mockRejectedValue(new Error('Network error'));

      const { result } = renderHook(() => useDiscovery());

      await act(async () => {
        await result.current.sendMessage('Test');
      });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.messages).toHaveLength(1);
      expect(result.current.messages[0].role).toBe('user');
    });

    it('handles 500 error response', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: false,
        status: 500,
      } as Response);

      const { result } = renderHook(() => useDiscovery());

      await act(async () => {
        await result.current.sendMessage('Test');
      });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.messages).toHaveLength(1);
    });

    it('aborts previous request when new message sent', async () => {
      const abortSpy = vi.fn();
      let capturedSignal: AbortSignal | undefined;

      vi.mocked(fetch).mockImplementation((_url, options) => {
        capturedSignal = options?.signal as AbortSignal;
        capturedSignal?.addEventListener('abort', abortSpy);
        return new Promise(() => {});
      });

      const { result } = renderHook(() => useDiscovery());

      act(() => {
        result.current.sendMessage('First');
      });

      act(() => {
        result.current.sendMessage('Second');
      });

      expect(abortSpy).toHaveBeenCalled();
    });

    it('handles abort error silently and removes the placeholder', async () => {
      const abortError = new DOMException('Aborted', 'AbortError');
      vi.mocked(fetch).mockRejectedValue(abortError);

      const { result } = renderHook(() => useDiscovery());

      await act(async () => {
        await result.current.sendMessage('Test');
      });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      // Aborted request removes the empty assistant placeholder — only user message remains
      expect(result.current.messages).toHaveLength(1);
      expect(result.current.messages[0].role).toBe('user');
    });
  });

  describe('updateMetadata', () => {
    it('patches metadata fields without triggering an API call', async () => {
      const chunks = [
        'data: {"type":"metadata","metadata":{"topic":"AI","depth":"standard","audienceLevel":"intermediate","audience":"general","focusAreas":[],"tone":"casual","durationTarget":10,"ready":true}}\n',
        'data: [DONE]\n',
      ];

      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        body: new MockReadableStream(chunks),
      } as unknown as Response);

      const { result } = renderHook(() => useDiscovery());

      await act(async () => {
        await result.current.sendMessage('AI');
      });

      await waitFor(() => {
        expect(result.current.metadata).not.toBeNull();
      });

      const callCountBefore = vi.mocked(fetch).mock.calls.length;

      act(() => {
        result.current.updateMetadata({ depth: 'deep_dive' });
      });

      expect(result.current.metadata?.depth).toBe('deep_dive');
      expect(vi.mocked(fetch).mock.calls.length).toBe(callCountBefore);
    });

    it('is a no-op when metadata is null', () => {
      const { result } = renderHook(() => useDiscovery());

      expect(result.current.metadata).toBeNull();

      act(() => {
        result.current.updateMetadata({ depth: 'eli5' });
      });

      expect(result.current.metadata).toBeNull();
    });
  });

  describe('reset', () => {
    it('clears all messages', async () => {
      const chunks = ['data: {"type":"content","content":"Response"}\n', 'data: [DONE]\n'];

      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        body: new MockReadableStream(chunks),
      } as unknown as Response);

      const { result } = renderHook(() => useDiscovery());

      await act(async () => {
        await result.current.sendMessage('Test');
      });

      await waitFor(() => {
        expect(result.current.messages.length).toBeGreaterThan(0);
      });

      act(() => {
        result.current.reset();
      });

      expect(result.current.messages).toEqual([]);
    });

    it('clears metadata', async () => {
      const chunks = ['data: {"type":"metadata","metadata":{"topic":"Test"}}\n', 'data: [DONE]\n'];

      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        body: new MockReadableStream(chunks),
      } as unknown as Response);

      const { result } = renderHook(() => useDiscovery());

      await act(async () => {
        await result.current.sendMessage('Test');
      });

      await waitFor(() => {
        expect(result.current.metadata).not.toBeNull();
      });

      act(() => {
        result.current.reset();
      });

      expect(result.current.metadata).toBeNull();
    });

    it('resets isComplete to false', async () => {
      const chunks = ['data: {"type":"metadata","metadata":{"ready":true}}\n', 'data: [DONE]\n'];

      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        body: new MockReadableStream(chunks),
      } as unknown as Response);

      const { result } = renderHook(() => useDiscovery());

      await act(async () => {
        await result.current.sendMessage('Generate');
      });

      await waitFor(() => {
        expect(result.current.isComplete).toBe(true);
      });

      act(() => {
        result.current.reset();
      });

      expect(result.current.isComplete).toBe(false);
    });

    it('aborts any in-flight request', async () => {
      const abortSpy = vi.fn();
      let capturedSignal: AbortSignal | undefined;

      vi.mocked(fetch).mockImplementation((_url, options) => {
        capturedSignal = options?.signal as AbortSignal;
        capturedSignal?.addEventListener('abort', abortSpy);
        return new Promise(() => {});
      });

      const { result } = renderHook(() => useDiscovery());

      act(() => {
        result.current.sendMessage('Test');
      });

      act(() => {
        result.current.reset();
      });

      expect(abortSpy).toHaveBeenCalled();
    });
  });
});
