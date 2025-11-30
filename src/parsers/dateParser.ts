/**
 * Date Parser Module
 *
 * Supports multiple date formats used in Obsidian ecosystem:
 * 1. Tasks plugin emoji format: 📅 2025-11-29, 🛫 2025-11-29, etc.
 * 2. Dataview inline fields: [due:: 2025-11-29], (start:: 2025-11-29)
 * 3. Simple formats: @ 2025-11-29
 *
 * Based on patterns from obsidian-kanban plugin.
 */

import { moment } from "obsidian";

/**
 * Supported date field types
 */
export enum DateFieldType {
  Due = "due",
  Start = "start",
  Scheduled = "scheduled",
  Created = "created",
  Done = "completed",
  Cancelled = "cancelled",
}

/**
 * Available date format types for settings
 */
export type DateFormatType = "tasks" | "dataview" | "simple" | "kanban";

/**
 * Represents a parsed date field from a task line
 */
export interface ParsedDateField {
  /** The type of date field */
  type: DateFieldType;
  /** The parsed date value */
  date: moment.Moment;
  /** Original matched string */
  raw: string;
  /** Start index in the original string */
  start: number;
  /** End index in the original string */
  end: number;
  /** Format type: 'emoji' | 'dataview-bracket' | 'dataview-paren' | 'simple' | 'kanban' */
  format: "tasks" | "dataview-bracket" | "dataview-paren" | "simple" | "kanban";
  /** Whether the date includes specific time (for Kanban format) */
  hasTime?: boolean;
}

/**
 * Date format symbols used by Tasks plugin
 */
/**
 * Date format symbols used by Tasks plugin.
 * Keys match DateFieldType enum values.
 */
export const DATE_SYMBOLS: Record<DateFieldType, readonly string[]> = {
  [DateFieldType.Due]: ["📅", "📆", "🗓"],
  [DateFieldType.Start]: ["🛫"],
  [DateFieldType.Scheduled]: ["⏳", "⌛"],
  [DateFieldType.Created]: ["➕"],
  [DateFieldType.Done]: ["✅"],
  [DateFieldType.Cancelled]: ["❌"],
};

/**
 * Simple date trigger (fallback)
 */
const SIMPLE_DATE_TRIGGER = "@";

/**
 * ISO date pattern: YYYY-MM-DD
 */
const ISO_DATE_PATTERN = "(\\d{4}-\\d{2}-\\d{2})";

/**
 * Regex patterns for Tasks plugin emoji format
 * Each pattern captures the date string and optional time (HH:mm)
 * Format: 📅 YYYY-MM-DD or 📅 YYYY-MM-DD HH:mm
 */
const EMOJI_DATE_PATTERNS: Array<{ type: DateFieldType; regex: RegExp }> = [
  {
    type: DateFieldType.Due,
    regex: /[📅📆🗓]\uFE0F?\s*(\d{4}-\d{2}-\d{2})(?:\s+(\d{1,2}:\d{2}))?/gu,
  },
  {
    type: DateFieldType.Start,
    regex: /🛫\uFE0F?\s*(\d{4}-\d{2}-\d{2})(?:\s+(\d{1,2}:\d{2}))?/gu,
  },
  {
    type: DateFieldType.Scheduled,
    regex: /[⏳⌛]\uFE0F?\s*(\d{4}-\d{2}-\d{2})(?:\s+(\d{1,2}:\d{2}))?/gu,
  },
  {
    type: DateFieldType.Created,
    regex: /➕\uFE0F?\s*(\d{4}-\d{2}-\d{2})(?:\s+(\d{1,2}:\d{2}))?/gu,
  },
  {
    type: DateFieldType.Done,
    regex: /✅\uFE0F?\s*(\d{4}-\d{2}-\d{2})(?:\s+(\d{1,2}:\d{2}))?/gu,
  },
  {
    type: DateFieldType.Cancelled,
    regex: /❌\uFE0F?\s*(\d{4}-\d{2}-\d{2})(?:\s+(\d{1,2}:\d{2}))?/gu,
  },
];

/**
 * Dataview inline field wrappers
 */
const DATAVIEW_WRAPPERS: Record<string, string> = {
  "[": "]",
  "(": ")",
};

/**
 * Dataview field key aliases that map to DateFieldType
 */
const DATAVIEW_KEY_ALIASES: Record<string, DateFieldType> = {
  due: DateFieldType.Due,
  "due date": DateFieldType.Due,
  duedate: DateFieldType.Due,
  start: DateFieldType.Start,
  "start date": DateFieldType.Start,
  startdate: DateFieldType.Start,
  scheduled: DateFieldType.Scheduled,
  "scheduled date": DateFieldType.Scheduled,
  scheduleddate: DateFieldType.Scheduled,
  created: DateFieldType.Created,
  "created date": DateFieldType.Created,
  createddate: DateFieldType.Created,
  done: DateFieldType.Done,
  "done date": DateFieldType.Done,
  donedate: DateFieldType.Done,
  completed: DateFieldType.Done,
  "completion date": DateFieldType.Done,
  completion: DateFieldType.Done,
  cancelled: DateFieldType.Cancelled,
  canceled: DateFieldType.Cancelled,
  "cancelled date": DateFieldType.Cancelled,
  "canceled date": DateFieldType.Cancelled,
};

/**
 * Simple date pattern (@ YYYY-MM-DD)
 */
const SIMPLE_DATE_REGEX = /@\s*(\d{4}-\d{2}-\d{2})/g;

/**
 * Kanban date pattern: @{YYYY-MM-DD}
 */
const KANBAN_DATE_REGEX = /@\{(\d{4}-\d{2}-\d{2})\}/g;

/**
 * Kanban time pattern: @@{HH:mm}
 */
const KANBAN_TIME_REGEX = /@@\{(\d{1,2}:\d{2})\}/g;

/**
 * Extracts all date fields from a line using emoji format (Tasks plugin style)
 * Supports optional time: 📅 YYYY-MM-DD HH:mm
 */
function extractEmojiDates(line: string): ParsedDateField[] {
  const results: ParsedDateField[] = [];

  for (const { type, regex } of EMOJI_DATE_PATTERNS) {
    // Reset regex lastIndex for each line
    const re = new RegExp(regex.source, regex.flags);
    let match: RegExpExecArray | null;

    while ((match = re.exec(line)) !== null) {
      const dateStr = match[1];
      const timeStr = match[2]; // Optional time capture group
      const date = moment(dateStr);

      if (date.isValid()) {
        // Apply time if present
        let hasTime = false;
        if (timeStr) {
          const [hours, minutes] = timeStr.split(":").map(Number);
          date.hour(hours).minute(minutes).second(0);
          hasTime = true;
        }

        results.push({
          type,
          date,
          raw: match[0],
          start: match.index,
          end: match.index + match[0].length,
          format: "tasks",
          hasTime,
        });
      }
    }
  }

  return results;
}

/**
 * Finds the '::' separator in a Dataview inline field
 */
function findDataviewSeparator(
  line: string,
  start: number,
): { key: string; valueIndex: number } | undefined {
  const sep = line.indexOf("::", start);
  if (sep < 0) return undefined;

  return {
    key: line.substring(start, sep).trim().toLowerCase(),
    valueIndex: sep + 2,
  };
}

/**
 * Finds matching closing bracket, respecting nesting and escapes
 */
function findClosingBracket(
  line: string,
  start: number,
  open: string,
  close: string,
): { value: string; endIndex: number } | undefined {
  let nesting = 0;
  let escaped = false;

  for (let i = start; i < line.length; i++) {
    const char = line.charAt(i);

    if (char === "\\") {
      escaped = !escaped;
      continue;
    }

    if (escaped) {
      escaped = false;
      continue;
    }

    if (char === open) nesting++;
    else if (char === close) nesting--;

    if (nesting < 0) {
      return {
        value: line.substring(start, i).trim(),
        endIndex: i + 1,
      };
    }

    escaped = false;
  }

  return undefined;
}

/**
 * Extracts all date fields from a line using Dataview inline field format
 * Supports both [key:: value] and (key:: value) formats
 */
function extractDataviewDates(line: string): ParsedDateField[] {
  const results: ParsedDateField[] = [];

  for (const open of Object.keys(DATAVIEW_WRAPPERS)) {
    const close = DATAVIEW_WRAPPERS[open];
    let searchIndex = 0;

    while (searchIndex < line.length) {
      const foundIndex = line.indexOf(open, searchIndex);
      if (foundIndex < 0) break;

      // Find the :: separator
      const keyInfo = findDataviewSeparator(line, foundIndex + 1);
      if (!keyInfo) {
        searchIndex = foundIndex + 1;
        continue;
      }

      // Check if key contains other brackets (invalid)
      const keyPart = line.substring(foundIndex + 1, keyInfo.valueIndex - 2);
      let hasInvalidChar = false;
      for (const sep of Object.keys(DATAVIEW_WRAPPERS).concat(
        Object.values(DATAVIEW_WRAPPERS),
      )) {
        if (keyPart.includes(sep)) {
          hasInvalidChar = true;
          break;
        }
      }

      if (hasInvalidChar) {
        searchIndex = foundIndex + 1;
        continue;
      }

      // Find closing bracket
      const valueInfo = findClosingBracket(
        line,
        keyInfo.valueIndex,
        open,
        close,
      );
      if (!valueInfo) {
        searchIndex = foundIndex + 1;
        continue;
      }

      // Check if key maps to a known date type
      const dateType = DATAVIEW_KEY_ALIASES[keyInfo.key];
      if (!dateType) {
        searchIndex = valueInfo.endIndex;
        continue;
      }

      // Try to parse the value as a date
      const dateStr = valueInfo.value.trim();
      // Support both YYYY-MM-DD and other common formats
      const dateMatch = dateStr.match(/^\d{4}-\d{2}-\d{2}/);
      if (!dateMatch) {
        searchIndex = valueInfo.endIndex;
        continue;
      }

      const date = moment(dateMatch[0]);
      if (!date.isValid()) {
        searchIndex = valueInfo.endIndex;
        continue;
      }

      results.push({
        type: dateType,
        date,
        raw: line.substring(foundIndex, valueInfo.endIndex),
        start: foundIndex,
        end: valueInfo.endIndex,
        format: open === "[" ? "dataview-bracket" : "dataview-paren",
      });

      searchIndex = valueInfo.endIndex;
    }
  }

  return results;
}

/**
 * Extracts dates using simple @ format
 */
function extractSimpleDates(line: string): ParsedDateField[] {
  const results: ParsedDateField[] = [];
  const re = new RegExp(SIMPLE_DATE_REGEX.source, SIMPLE_DATE_REGEX.flags);
  let match: RegExpExecArray | null;

  while ((match = re.exec(line)) !== null) {
    const dateStr = match[1];
    const date = moment(dateStr);

    if (date.isValid()) {
      results.push({
        type: DateFieldType.Due, // Simple @ format defaults to due date
        date,
        raw: match[0],
        start: match.index,
        end: match.index + match[0].length,
        format: "simple",
      });
    }
  }

  return results;
}

/**
 * Extracts dates using Kanban format @{YYYY-MM-DD} and @@{HH:mm}
 * Time is optional and will be combined with date if present
 */
function extractKanbanDates(line: string): ParsedDateField[] {
  const results: ParsedDateField[] = [];
  const dateRe = new RegExp(KANBAN_DATE_REGEX.source, KANBAN_DATE_REGEX.flags);
  const timeRe = new RegExp(KANBAN_TIME_REGEX.source, KANBAN_TIME_REGEX.flags);

  // Extract time first (if present, applies to all dates in line)
  const timeMatch = timeRe.exec(line);
  let hasTime = false;
  let hours = 0;
  let minutes = 0;

  if (timeMatch) {
    hasTime = true;
    const [h, m] = timeMatch[1].split(":").map(Number);
    hours = h;
    minutes = m;
  }

  // Extract dates
  let match: RegExpExecArray | null;
  while ((match = dateRe.exec(line)) !== null) {
    const dateStr = match[1];
    const date = moment(dateStr);

    if (date.isValid()) {
      // Apply time if present
      if (hasTime) {
        date.hour(hours).minute(minutes).second(0);
      }

      results.push({
        type: DateFieldType.Due, // Kanban format defaults to due date
        date,
        raw: match[0],
        start: match.index,
        end: match.index + match[0].length,
        format: "kanban",
        hasTime,
      });
    }
  }

  return results;
}

/**
 * Extracts all date fields from a task line.
 * Combines emoji, dataview, simple, and kanban formats.
 * Results are sorted by position in the line.
 *
 * @param line - The task line to parse
 * @param formatFilter - Optional filter to only extract specific format type
 * @returns Array of parsed date fields, sorted by position
 */
export function extractAllDates(
  line: string,
  formatFilter?: DateFormatType,
): ParsedDateField[] {
  let allDates: ParsedDateField[] = [];

  // Extract based on format filter (or all if no filter)
  if (!formatFilter || formatFilter === "tasks") {
    allDates.push(...extractEmojiDates(line));
  }
  if (!formatFilter || formatFilter === "dataview") {
    allDates.push(...extractDataviewDates(line));
  }
  if (!formatFilter || formatFilter === "simple") {
    allDates.push(...extractSimpleDates(line));
  }
  if (!formatFilter || formatFilter === "kanban") {
    allDates.push(...extractKanbanDates(line));
  }

  // Sort by start position
  allDates.sort((a, b) => a.start - b.start);

  // Remove overlapping entries (keep the first one at each position)
  const filtered: ParsedDateField[] = [];
  for (const date of allDates) {
    const lastDate = filtered[filtered.length - 1];
    if (!lastDate || lastDate.end <= date.start) {
      filtered.push(date);
    }
  }

  return filtered;
}

/**
 * Gets the primary date from a task line based on priority.
 * Priority order (configurable): due > scheduled > start > created > done > cancelled
 *
 * @param line - The task line to parse
 * @param priorityOrder - Optional custom priority order
 * @param formatFilter - Optional filter to only consider specific format type
 * @returns The primary date field, or null if no dates found
 */
export function getPrimaryDate(
  line: string,
  priorityOrder: DateFieldType[] = [
    DateFieldType.Due,
    DateFieldType.Scheduled,
    DateFieldType.Start,
    DateFieldType.Created,
    DateFieldType.Done,
    DateFieldType.Cancelled,
  ],
  formatFilter?: DateFormatType,
): ParsedDateField | null {
  const allDates = extractAllDates(line, formatFilter);

  if (allDates.length === 0) return null;

  // Find the date with highest priority
  for (const type of priorityOrder) {
    const found = allDates.find((d) => d.type === type);
    if (found) return found;
  }

  // Fallback to first date found
  return allDates[0];
}

/**
 * Gets a specific date type from a task line
 *
 * @param line - The task line to parse
 * @param type - The date field type to find
 * @returns The date field, or null if not found
 */
export function getDateByType(
  line: string,
  type: DateFieldType,
): ParsedDateField | null {
  const allDates = extractAllDates(line);
  return allDates.find((d) => d.type === type) ?? null;
}

/**
 * Checks if a line contains any supported date format
 *
 * @param line - The line to check
 * @returns True if the line contains a date
 */
export function hasDate(line: string): boolean {
  return extractAllDates(line).length > 0;
}

/**
 * Removes all date metadata from a task line, returning clean title
 *
 * @param line - The task line
 * @returns The line with all date metadata removed
 */
export function stripDates(line: string): string {
  const dates = extractAllDates(line);

  if (dates.length === 0) return line;

  // Remove dates from end to start to preserve indices
  let result = line;
  for (let i = dates.length - 1; i >= 0; i--) {
    const date = dates[i];
    result = result.slice(0, date.start) + result.slice(date.end);
  }

  // Clean up extra whitespace
  return result.replace(/\s+/g, " ").trim();
}

/**
 * Formats a date for display based on the original format type
 *
 * @param type - The date field type
 * @param date - The date to format
 * @param format - The format style to use
 * @param includeTime - Whether to include time component (supported by tasks, kanban, and dataview)
 * @returns Formatted date string
 */
export function formatDate(
  type: DateFieldType,
  date: moment.Moment,
  format:
    | "tasks"
    | "dataview-bracket"
    | "dataview-paren"
    | "simple"
    | "kanban" = "tasks",
  includeTime: boolean = false,
): string {
  const dateStr = date.format("YYYY-MM-DD");
  const timeStr = date.format("HH:mm");
  const hasValidTime =
    includeTime && (date.hours() !== 0 || date.minutes() !== 0);

  switch (format) {
    case "tasks": {
      const symbols = DATE_SYMBOLS[type];
      // Tasks format: 📅 YYYY-MM-DD HH:mm
      if (hasValidTime) {
        return `${symbols[0]} ${dateStr} ${timeStr}`;
      }
      return `${symbols[0]} ${dateStr}`;
    }
    case "dataview-bracket":
      // Dataview supports datetime format: YYYY-MM-DDTHH:mm
      if (hasValidTime) {
        return `[${type}:: ${dateStr}T${timeStr}]`;
      }
      return `[${type}:: ${dateStr}]`;
    case "dataview-paren":
      if (hasValidTime) {
        return `(${type}:: ${dateStr}T${timeStr})`;
      }
      return `(${type}:: ${dateStr})`;
    case "simple":
      return `@ ${dateStr}`;
    case "kanban":
      // Kanban uses separate time notation @@{HH:mm}
      if (hasValidTime) {
        return `@{${dateStr}} @@{${timeStr}}`;
      }
      return `@{${dateStr}}`;
    default:
      return dateStr;
  }
}

/**
 * Checks if a Date object has a meaningful time component (not midnight)
 *
 * @param date - The Date object to check
 * @returns True if the date has hours or minutes set
 */
export function hasTimeComponent(date: Date): boolean {
  return date.getHours() !== 0 || date.getMinutes() !== 0;
}

/**
 * Gets human-readable label for a date field type
 */
export function getDateTypeLabel(type: DateFieldType): string {
  switch (type) {
    case DateFieldType.Due:
      return "Due";
    case DateFieldType.Start:
      return "Start";
    case DateFieldType.Scheduled:
      return "Scheduled";
    case DateFieldType.Created:
      return "Created";
    case DateFieldType.Done:
      return "Done";
    case DateFieldType.Cancelled:
      return "Cancelled";
    default:
      return type;
  }
}

/**
 * Gets the emoji symbol for a date field type
 */
export function getDateTypeEmoji(type: DateFieldType): string {
  return DATE_SYMBOLS[type][0];
}
