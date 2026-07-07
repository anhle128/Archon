/**
 * Telegram Markdown Converter
 *
 * Converts GitHub-flavored markdown (from AI assistants) to Telegram MarkdownV2 format.
 * Uses telegramify-markdown when it is available, with a local fallback when the
 * package cannot load in the current install.
 */

type TelegramifyMarkdown = (markdown: string, mode: 'escape') => string;

import { createLogger } from '@archon/paths';

interface TelegramifyMarkdownModule {
  default?: TelegramifyMarkdown;
}

const telegramifyMarkdownModule = (await import('telegramify-markdown').catch(
  () => null
)) as TelegramifyMarkdownModule | null;
const telegramifyMarkdown = telegramifyMarkdownModule?.default;

/** Lazy-initialized logger (deferred so test mocks can intercept createLogger) */
let cachedLog: ReturnType<typeof createLogger> | undefined;
function getLog(): ReturnType<typeof createLogger> {
  if (!cachedLog) cachedLog = createLogger('telegram-markdown');
  return cachedLog;
}

/**
 * Convert GitHub-flavored markdown to Telegram MarkdownV2 format
 *
 * Transformations:
 * - Headers (##) → Bold (*text*)
 * - **bold** → *bold*
 * - *italic* → _italic_
 * - Lists (- item) → Escaped bullet points
 * - Special characters escaped for MarkdownV2
 *
 * @param markdown - GitHub-flavored markdown text
 * @returns Telegram MarkdownV2 formatted text
 */
export function convertToTelegramMarkdown(markdown: string): string {
  if (!markdown || markdown.trim() === '') {
    return markdown;
  }

  if (!telegramifyMarkdown) {
    return convertToTelegramMarkdownFallback(markdown);
  }

  try {
    // 'escape' strategy: escape unsupported tags rather than remove them
    let result = telegramifyMarkdown(markdown, 'escape');

    // Post-processing: Fix remaining **bold** patterns that weren't converted
    // The library sometimes leaves **text** when inside headers like ### **text**
    // MarkdownV2 requires single asterisk *bold* not double **bold**
    result = fixRemainingDoubleBold(result);

    return result;
  } catch (error) {
    getLog().warn({ err: error }, 'telegram.markdown_conversion_failed');
    return convertToTelegramMarkdownFallback(markdown);
  }
}

function convertToTelegramMarkdownFallback(markdown: string): string {
  const placeholders: string[] = [];

  const stash = (replacement: string): string => {
    const token = `\u0001${placeholders.length}\u0002`;
    placeholders.push(replacement);
    return token;
  };

  const restore = (text: string): string =>
    placeholders.reduce(
      (acc, replacement, index) => acc.replaceAll(`\u0001${index}\u0002`, replacement),
      text
    );

  const processInline = (segment: string): string => {
    let text = segment;

    text = text.replace(/`[^`\n]+`/g, match => stash(match));
    text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, match => stash(match));
    text = text.replace(/(?<!\\)\*\*([^*\n]+)\*\*/g, (_, inner: string) =>
      stash(`*${escapeMarkdownV2(inner)}*`)
    );
    text = text.replace(/(?<![\\*])\*([^*\n]+)\*(?!\*)/g, (_, inner: string) =>
      stash(`_${escapeMarkdownV2(inner)}_`)
    );

    return escapeMarkdownV2(text);
  };

  const codeBlockPattern = /```[\s\S]*?```/g;
  const text = markdown.replace(codeBlockPattern, match => stash(match));
  const lines = text.split('\n');
  let shouldAppendNewline = false;

  const processedLines = lines.map(line => {
    const quoteMatch = /^(\s*>\s?)(.*)$/.exec(line);
    if (quoteMatch) {
      shouldAppendNewline = true;
      return `${quoteMatch[1]}${processInline(quoteMatch[2])}`;
    }

    const headerMatch = /^(#{1,6})\s+(.*)$/.exec(line);
    if (headerMatch) {
      return `*${processInline(headerMatch[2])}*`;
    }

    const bulletMatch = /^(\s*[-*+]\s+)(.*)$/.exec(line);
    if (bulletMatch) {
      return `${bulletMatch[1]}${processInline(bulletMatch[2])}`;
    }

    const orderedMatch = /^(\s*\d+\.\s+)(.*)$/.exec(line);
    if (orderedMatch) {
      return `${orderedMatch[1]}${processInline(orderedMatch[2])}`;
    }

    return processInline(line);
  });

  const restored = restore(processedLines.join('\n'));
  if (shouldAppendNewline && !restored.endsWith('\n')) {
    return `${restored}\n`;
  }

  return restored;
}

/**
 * Fix remaining **bold** patterns that weren't converted by the library
 * Converts **text** to *text* for MarkdownV2 compatibility
 *
 * @param text - Partially converted text
 * @returns Text with all **bold** converted to *bold*
 */
function fixRemainingDoubleBold(text: string): string {
  // Match **text** but not already escaped \*\*
  // Replace with single asterisk *text*
  return text.replace(/(?<!\\)\*\*([^*]+)\*\*/g, '*$1*');
}

/**
 * Escape special characters for Telegram MarkdownV2
 * Used as fallback when conversion fails
 *
 * Characters that need escaping: _ * [ ] ( ) ~ ` > # + - = | { } . !
 *
 * @param text - Plain text to escape
 * @returns Text with special characters escaped
 */
export function escapeMarkdownV2(text: string): string {
  // Characters that must be escaped in MarkdownV2
  const specialChars = /([_*[\]()~`>#+\-=|{}.!\\])/g;
  return text.replace(specialChars, '\\$1');
}

/**
 * Check if text appears to be already in MarkdownV2 format
 * (contains escaped characters)
 *
 * @param text - Text to check
 * @returns True if text appears already escaped
 */
export function isAlreadyEscaped(text: string): boolean {
  // Look for patterns like \* \_ \[ etc.
  return /\\[_*[\]()~`>#+\-=|{}.!]/.test(text);
}

/**
 * Strip markdown formatting for plain text display
 * Used for long messages that can't be formatted (would break when split)
 *
 * Removes:
 * - Headers (##, ###, etc.)
 * - Bold (**text** or __text__)
 * - Italic (*text* or _text_)
 * - Strikethrough (~~text~~)
 * - Code blocks (```...```)
 * - Inline code (`code`)
 * - Links [text](url) → text (url)
 *
 * @param markdown - Markdown text to strip
 * @returns Plain text without markdown symbols
 */
export function stripMarkdown(markdown: string): string {
  let result = markdown;

  // Remove code blocks first (preserve content)
  result = result.replace(/```[\s\S]*?```/g, match => {
    // Extract content between ``` markers
    const content = match.replace(/```\w*\n?/g, '').replace(/```$/g, '');
    return content.trim();
  });

  // Remove inline code (preserve content)
  result = result.replace(/`([^`]+)`/g, '$1');

  // Remove headers (##, ###, etc.) - keep the text
  result = result.replace(/^#{1,6}\s+/gm, '');

  // Remove bold **text** or __text__
  result = result.replace(/\*\*([^*]+)\*\*/g, '$1');
  result = result.replace(/__([^_]+)__/g, '$1');

  // Remove italic *text* or _text_ (careful not to match list items)
  result = result.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, '$1');
  result = result.replace(/(?<!_)_([^_]+)_(?!_)/g, '$1');

  // Remove strikethrough ~~text~~
  result = result.replace(/~~([^~]+)~~/g, '$1');

  // Convert links [text](url) to text (url)
  result = result.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)');

  // Clean up multiple blank lines
  result = result.replace(/\n{3,}/g, '\n\n');

  return result;
}
