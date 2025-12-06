/**
 * Color Service - Handles event color resolution based on rules and settings
 */
import { moment } from "obsidian";
import type { CalendarSettings } from "../Settings";
import {
  ColorConditionType,
  type ColorRule,
  type ColorTheme,
} from "../types/colorTypes";
import { DateFieldType, type ParsedDateField } from "../parsers/dateParser";

/**
 * Task data interface for color resolution
 * Matches the TaskLine interface from CalendarView
 */
export interface TaskColorData {
  title: string;
  markdown: string;
  date: moment.Moment;
  dateType: DateFieldType;
  /** All parsed date fields from this task */
  allDates: ParsedDateField[];
  completed: boolean;
  sectionId: string;
}

/**
 * Section data interface for color resolution
 */
export interface SectionColorData {
  id: string;
  name: string;
}

/**
 * Color resolution service
 *
 * Color Priority (highest to lowest):
 * 1. Conditional Rules - Global and file-specific rules evaluated in order
 * 2. Section Custom Color - User-defined color for specific section (only in "All Calendars" view)
 * 3. Calendar Base Color - User-defined color for the entire calendar file
 * 4. Global Default - Default color from plugin settings
 */
export class ColorService {
  /**
   * Get the color for an event based on rules and settings
   *
   * @param task - Task data for condition checking
   * @param filePath - Current file path
   * @param sections - Map of section ID to section data
   * @param settings - Plugin settings
   * @param isDarkMode - Whether dark mode is active
   * @param isAllSectionsView - Whether displaying all sections combined
   * @returns Color string (hex, hsl, or CSS variable)
   */
  static getEventColor(
    task: TaskColorData,
    filePath: string,
    sections: Map<string, SectionColorData>,
    settings: CalendarSettings,
    isDarkMode: boolean,
    isAllSectionsView: boolean = false,
  ): string {
    const { defaultEventColor, colorRules, calendarSources } = settings.colors;
    const sourceConfig = calendarSources[filePath];

    // Priority 1: Conditional Rules (highest priority)
    // - Rules are evaluated in order, first match wins
    // - Rules can be global or file-specific (applyToFiles)
    for (const rule of colorRules) {
      if (!rule.enabled) continue;

      // Check if rule is limited to specific files
      if (rule.applyToFiles && rule.applyToFiles.length > 0) {
        if (!rule.applyToFiles.includes(filePath)) continue;
      }

      if (this.checkCondition(task, rule, sections)) {
        return this.resolveColor(rule.color, isDarkMode);
      }
    }

    // Priority 2: Section Custom Color (only in "All Calendars" view)
    // - User-defined color for this specific section
    if (isAllSectionsView && sourceConfig?.sectionColors?.[task.sectionId]) {
      return this.resolveColor(
        sourceConfig.sectionColors[task.sectionId],
        isDarkMode,
      );
    }

    // Priority 3: Calendar Base Color
    // - User-defined color for the entire calendar file
    if (sourceConfig?.color) {
      return this.resolveColor(sourceConfig.color, isDarkMode);
    }

    // Priority 4: Global Default (lowest priority)
    return this.resolveColor(defaultEventColor, isDarkMode);
  }

  /**
   * Check if a task matches a rule's condition
   */
  private static checkCondition(
    task: TaskColorData,
    rule: ColorRule,
    sections: Map<string, SectionColorData>,
  ): boolean {
    switch (rule.conditionType) {
      case ColorConditionType.IsOverdue:
        // Only incomplete tasks with dates can be overdue
        if (task.completed || !task.date) return false;
        return task.date.isBefore(moment(), "day");

      case ColorConditionType.IsCompleted:
        return task.completed;

      case ColorConditionType.HasTag:
        if (!rule.conditionValue) return false;
        // Check both title and full markdown for tag
        const tagPattern = rule.conditionValue.startsWith("#")
          ? rule.conditionValue
          : `#${rule.conditionValue}`;
        return (
          task.title.includes(tagPattern) || task.markdown.includes(tagPattern)
        );

      case ColorConditionType.TitleContains:
        if (!rule.conditionValue) return false;
        return task.title
          .toLowerCase()
          .includes(rule.conditionValue.toLowerCase());

      case ColorConditionType.SectionIs:
        if (!rule.conditionValue) return false;
        const section = sections.get(task.sectionId);
        if (!section) return false;
        return section.name.toLowerCase() === rule.conditionValue.toLowerCase();

      case ColorConditionType.HasDue:
        // Check if task has any due date in allDates array
        return task.allDates.some((d) => d.type === DateFieldType.Due);

      case ColorConditionType.Always:
        return true;

      default:
        return false;
    }
  }

  /**
   * Resolve color theme to single color based on mode
   */
  private static resolveColor(theme: ColorTheme, isDarkMode: boolean): string {
    return isDarkMode ? theme.dark : theme.light;
  }

  /**
   * Generate a deterministic color from a string (for random calendar colors)
   * Uses HSL for visually pleasing colors
   * @param str - String to hash (typically file path)
   * @param isDarkMode - Whether dark mode is active
   * @returns HSL color string
   */
  static hashStringToColor(str: string, isDarkMode: boolean): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = str.charCodeAt(i) + ((hash << 5) - hash);
      hash = hash & hash; // Convert to 32-bit integer
    }

    // Generate hue from hash (0-360)
    const h = Math.abs(hash % 360);
    // Adjust saturation and lightness for mode
    const s = isDarkMode ? 55 : 65;
    const l = isDarkMode ? 55 : 45;

    return `hsl(${h}, ${s}%, ${l}%)`;
  }

  /**
   * Generate a pleasant random color for a new calendar
   * Returns a color theme with both light and dark variants
   */
  static generateRandomColorTheme(): ColorTheme {
    const hue = Math.floor(Math.random() * 360);
    return {
      light: `hsl(${hue}, 65%, 45%)`,
      dark: `hsl(${hue}, 55%, 55%)`,
    };
  }

  /**
   * Check if a color value is dark (for determining text color)
   * @param color - Hex color string
   * @returns true if the color is dark
   */
  static isColorDark(color: string): boolean {
    // Handle hex colors
    if (color.startsWith("#")) {
      const hex = color.slice(1);
      const r = parseInt(hex.slice(0, 2), 16);
      const g = parseInt(hex.slice(2, 4), 16);
      const b = parseInt(hex.slice(4, 6), 16);
      // Using relative luminance formula
      const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
      return luminance < 0.5;
    }
    // Default to light for non-hex colors
    return false;
  }
}
