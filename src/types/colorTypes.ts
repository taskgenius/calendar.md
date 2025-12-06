/**
 * Color configuration types for calendar event styling
 */

/**
 * Color theme supporting both light and dark modes
 */
export interface ColorTheme {
  light: string;
  dark: string;
}

/**
 * Condition types for conditional coloring rules
 */
export enum ColorConditionType {
  /** Task is overdue (past due date and not completed) */
  IsOverdue = "is_overdue",
  /** Task is completed */
  IsCompleted = "is_completed",
  /** Task contains a specific tag */
  HasTag = "has_tag",
  /** Task title contains specific text */
  TitleContains = "title_contains",
  /** Task belongs to a specific section/heading */
  SectionIs = "section_is",
  /** Task has a due date */
  HasDue = "has_due",
  /** Always match (for fallback rules) */
  Always = "always",
}

/**
 * Get human-readable label for condition type
 */
export function getConditionTypeLabel(type: ColorConditionType): string {
  switch (type) {
    case ColorConditionType.IsOverdue:
      return "Is Overdue";
    case ColorConditionType.IsCompleted:
      return "Is Completed";
    case ColorConditionType.HasTag:
      return "Has Tag";
    case ColorConditionType.TitleContains:
      return "Title Contains";
    case ColorConditionType.SectionIs:
      return "In Section";
    case ColorConditionType.HasDue:
      return "Has Due Date";
    case ColorConditionType.Always:
      return "Always";
    default:
      return type;
  }
}

/**
 * Check if condition type requires a value parameter
 */
export function conditionRequiresValue(type: ColorConditionType): boolean {
  return [
    ColorConditionType.HasTag,
    ColorConditionType.TitleContains,
    ColorConditionType.SectionIs,
  ].includes(type);
}

/**
 * Color rule for conditional styling
 */
export interface ColorRule {
  /** Unique identifier */
  id: string;
  /** Whether the rule is active */
  enabled: boolean;
  /** User-defined rule name */
  name: string;
  /** Type of condition to check */
  conditionType: ColorConditionType;
  /** Value for conditions that require parameters (e.g., tag name) */
  conditionValue?: string;
  /** Colors to apply when condition matches */
  color: ColorTheme;
  /** Optional: limit rule to specific file paths */
  applyToFiles?: string[];
}

/**
 * Configuration for a calendar source (file-level settings)
 */
export interface CalendarSourceConfig {
  /** Custom base color for this calendar */
  color?: ColorTheme;
  /** Per-section colors (keyed by section ID/name) */
  sectionColors?: Record<string, ColorTheme>;
}

/**
 * Complete color configuration structure
 */
export interface ColorSettings {
  /** Default event color when no rules match */
  defaultEventColor: ColorTheme;
  /** Ordered list of conditional coloring rules */
  colorRules: ColorRule[];
  /** Per-file color configurations, keyed by file path */
  calendarSources: Record<string, CalendarSourceConfig>;
}

/**
 * Default color settings
 */
export const DEFAULT_COLOR_SETTINGS: ColorSettings = {
  defaultEventColor: {
    light: "#6366f1", // Indigo 500
    dark: "#818cf8", // Indigo 400
  },
  colorRules: [],
  calendarSources: {},
};
