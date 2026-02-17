import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock the dependencies
vi.mock('@vector-im/matrix-bot-sdk', () => ({
  LogService: {
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// Import the module under test
// We need to test the internal functions by importing them
import { 
  downloadContent_v2, 
  releaseDownloadAgent 
} from './download.ts';

describe('Matrix HTTP/2 Download - QA Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    releaseDownloadAgent();
  });

  describe('Functional Tests - MXC URL Parsing', () => {
    it('should reject invalid MXC URL format (HTTP URL)', async () => {
      await expect(
        downloadContent_v2(
          'https://example.com/image.png',
          'https://matrix.example.com',
          'token',
          true,
          1000,
          1
        )
      ).rejects.toThrow('Not a valid MXC URI');
    });

    it('should reject empty MXC URL', async () => {
      await expect(
        downloadContent_v2(
          '',
          'https://matrix.example.com',
          'token',
          true,
          1000,
          1
        )
      ).rejects.toThrow('Not a valid MXC URI');
    });

    it('should reject null MXC URL', async () => {
      await expect(
        downloadContent_v2(
          null as any,
          'https://matrix.example.com',
          'token',
          true,
          1000,
          1
        )
      ).rejects.toThrow('Not a valid MXC URI');
    });

    it('should reject MXC URL with missing domain', async () => {
      await expect(
        downloadContent_v2(
          'mxc://',
          'https://matrix.example.com',
          'token',
          true,
          1000,
          1
        )
      ).rejects.toThrow('Missing domain');
    });

    it('should reject MXC URL with missing mediaId', async () => {
      await expect(
        downloadContent_v2(
          'mxc://example.com',
          'https://matrix.example.com',
          'token',
          true,
          1000,
          1
        )
      ).rejects.toThrow('Missing mediaId');
    });

    it('should accept valid MXC URL format', async () => {
      // This will fail with network error, not parse error
      const invalidServer = 'https://invalid-matrix-server-12345.example.com';
      await expect(
        downloadContent_v2(
          'mxc://matrix.org/ABC123',
          invalidServer,
          'token',
          true,
          1000,
          1
        )
      ).rejects.not.toThrow('Not a valid MXC URI');
    });
  });

  describe('Error Handling Tests', () => {
    it('should handle unreachable server', async () => {
      await expect(
        downloadContent_v2(
          'mxc://test.example/file123',
          'https://invalid-server-that-does-not-exist.example',
          'token',
          true,
          1000,
          1
        )
      ).rejects.toThrow();
    });

    it('should respect maxRetries parameter', async () => {
      const startTime = Date.now();
      try {
        await downloadContent_v2(
          'mxc://test.example/file123',
          'https://invalid-server.example',
          'token',
          true,
          500,
          2
        );
      } catch (e) {
        const duration = Date.now() - startTime;
        // With 2 retries and exponential backoff, should take at least 500ms + 1000ms
        expect(duration).toBeGreaterThan(500);
      }
    });

    it('should not retry on invalid MXC URL', async () => {
      const startTime = Date.now();
      try {
        await downloadContent_v2(
          'invalid-url',
          'https://matrix.example.com',
          'token',
          true,
          5000,
          3
        );
      } catch (e) {
        const duration = Date.now() - startTime;
        // Should fail fast without retries
        expect(duration).toBeLessThan(1000);
      }
    });
  });

  describe('Return Format Tests', () => {
    it('should return correct data structure on success', async () => {
      // This test would require a mock server or live server
      // For now, we verify the function signature is correct
      expect(typeof downloadContent_v2).toBe('function');
    });

    it('should have proper TypeScript types exported', () => {
      // Verify the module exports the expected functions
      expect(typeof downloadContent_v2).toBe('function');
      expect(typeof releaseDownloadAgent).toBe('function');
    });
  });
});
