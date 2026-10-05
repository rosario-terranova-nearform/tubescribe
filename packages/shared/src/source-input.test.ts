// Parser unit tests — must cover the cases the design lists:
// @handle, UC id, channel URL variants, list= param, PL... bare, video URL
// variants (watch?v=, youtu.be, /shorts/), bare 11-char id, plus the obvious
// rejects (empty, garbage, non-YouTube host).

import { describe, expect, it } from 'vitest';
import { SourceInputError, parseSourceInput } from './source-input.js';

const channel = (handle: string) => ({ kind: 'channel' as const, identifier: `@${handle}` });

describe('parseSourceInput', () => {
  describe('channel inputs', () => {
    it('parses a bare @handle', () => {
      expect(parseSourceInput('@mkbhd')).toEqual(channel('mkbhd'));
    });

    it('parses youtube.com/@handle with tracking query', () => {
      expect(parseSourceInput('https://www.youtube.com/@mkbhd?si=tracking')).toEqual(
        channel('mkbhd'),
      );
    });

    it('parses youtube.com/@handle without scheme', () => {
      expect(parseSourceInput('youtube.com/@mkbhd')).toEqual(channel('mkbhd'));
    });

    it('parses legacy /user/<name>', () => {
      expect(parseSourceInput('https://www.youtube.com/user/mkbhd')).toEqual(channel('mkbhd'));
    });

    it('parses legacy /c/<name>', () => {
      expect(parseSourceInput('https://www.youtube.com/c/MKBHD')).toEqual(channel('MKBHD'));
    });

    it('parses a bare UC channel id', () => {
      const uc = 'UCabcdefghijklmnopqrstuv';
      expect(parseSourceInput(uc)).toEqual({ kind: 'channel', identifier: uc });
    });

    it('parses /channel/<UC> URL', () => {
      const uc = 'UCabcdefghijklmnopqrstuv';
      expect(parseSourceInput(`https://youtube.com/channel/${uc}`)).toEqual({
        kind: 'channel',
        identifier: uc,
      });
    });
  });

  describe('playlist inputs', () => {
    it('parses a /playlist?list= URL', () => {
      expect(
        parseSourceInput('https://www.youtube.com/playlist?list=PLabc123def456ghi789jkl012'),
      ).toEqual({ kind: 'playlist', identifier: 'PLabc123def456ghi789jkl012' });
    });

    it('parses a /watch URL with v + list (list takes precedence)', () => {
      expect(
        parseSourceInput(
          'https://www.youtube.com/watch?v=abcdefghijk&list=PLabc123def456ghi789jkl012',
        ),
      ).toEqual({ kind: 'playlist', identifier: 'PLabc123def456ghi789jkl012' });
    });

    it('parses a bare PL id', () => {
      expect(parseSourceInput('PLabc123def456ghi789jkl012')).toEqual({
        kind: 'playlist',
        identifier: 'PLabc123def456ghi789jkl012',
      });
    });

    it('parses a bare UU (uploads) id', () => {
      expect(parseSourceInput('UUabcdefghijklmnopqrstuv12')).toEqual({
        kind: 'playlist',
        identifier: 'UUabcdefghijklmnopqrstuv12',
      });
    });
  });

  describe('video inputs', () => {
    it('parses youtu.be/<id>', () => {
      expect(parseSourceInput('https://youtu.be/abcdefghijk')).toEqual({
        kind: 'video',
        identifier: 'abcdefghijk',
      });
    });

    it('parses youtu.be/<id> without scheme', () => {
      expect(parseSourceInput('youtu.be/abcdefghijk')).toEqual({
        kind: 'video',
        identifier: 'abcdefghijk',
      });
    });

    it('parses /watch?v=<id>', () => {
      expect(parseSourceInput('https://www.youtube.com/watch?v=abcdefghijk')).toEqual({
        kind: 'video',
        identifier: 'abcdefghijk',
      });
    });

    it('parses /shorts/<id>', () => {
      expect(parseSourceInput('https://www.youtube.com/shorts/abcdefghijk')).toEqual({
        kind: 'video',
        identifier: 'abcdefghijk',
      });
    });

    it('parses a bare 11-char video id', () => {
      expect(parseSourceInput('abcdefghijk')).toEqual({
        kind: 'video',
        identifier: 'abcdefghijk',
      });
    });
  });

  describe('whitespace handling', () => {
    it('trims surrounding whitespace', () => {
      expect(parseSourceInput('   @mkbhd   ')).toEqual(channel('mkbhd'));
    });

    it('trims trailing newline', () => {
      expect(parseSourceInput('https://www.youtube.com/@mkbhd\n')).toEqual(channel('mkbhd'));
    });
  });

  describe('rejects', () => {
    it('throws on empty string', () => {
      expect(() => parseSourceInput('')).toThrow(SourceInputError);
    });

    it('throws on whitespace-only', () => {
      expect(() => parseSourceInput('   \t\n')).toThrow(SourceInputError);
    });

    it('throws on bare word that is not a known id shape', () => {
      // 15 chars: longer than a YouTube video id (11) so it shouldn't match
      // any of the bare-id formats.
      expect(() => parseSourceInput('notavalidstring')).toThrow(SourceInputError);
    });

    it('throws on home-page youtube URL with no path', () => {
      expect(() => parseSourceInput('https://www.youtube.com/')).toThrow(SourceInputError);
    });

    it('throws on non-YouTube host', () => {
      expect(() => parseSourceInput('https://example.com/foo')).toThrow(SourceInputError);
    });

    it('throws on bare mkbhd without @ (handle must include @)', () => {
      expect(() => parseSourceInput('mkbhd')).toThrow(SourceInputError);
    });

    it('error carries the raw input', () => {
      try {
        parseSourceInput('garbage');
        throw new Error('expected throw');
      } catch (e) {
        expect(e).toBeInstanceOf(SourceInputError);
        expect((e as SourceInputError).raw).toBe('garbage');
        expect((e as SourceInputError).code).toBe('SOURCE_INPUT_INVALID');
      }
    });
  });
});
