import {
  App,
  PluginSettingTab,
  Setting,
  setIcon,
  ColorComponent,
  ToggleComponent,
  ButtonComponent,
  TextComponent,
  DropdownComponent,
  ExtraButtonComponent,
} from "obsidian";

import type CalendarPlugin from "./main";
import {
  DateFieldType,
  getDateTypeLabel,
  type DateFormatType,
} from "./parsers/dateParser";
import {
  type ColorSettings,
  type ColorRule,
  type ColorTheme,
  ColorConditionType,
  getConditionTypeLabel,
  conditionRequiresValue,
  DEFAULT_COLOR_SETTINGS,
} from "./types/colorTypes";

/**
 * Plugin settings interface
 */
export interface CalendarSettings {
  /** Default calendar view: 'month' | 'week' | 'day' */
  defaultView: string;
  /** Week start day: 0 = Sunday, 1 = Monday */
  weekStart: number;
  /** Whether to show completed tasks */
  showCompleted: boolean;
  /** Whether to show checkbox on calendar events for quick completion */
  showEventCheckbox: boolean;
  /** Whether to move completed tasks to a specific section */
  moveOnComplete: boolean;
  /** The heading name (without #) to move completed tasks to */
  completedSectionName: string;
  /** Priority order for date field types (first = highest priority) */
  datePriority: DateFieldType[];
  /** Which date format to recognize (single selection) */
  recognizedDateFormat: DateFormatType;
  /** Color configuration */
  colors: ColorSettings;
}

/**
 * Default date priority order
 */
export const DEFAULT_DATE_PRIORITY: DateFieldType[] = [
  DateFieldType.Due,
  DateFieldType.Scheduled,
  DateFieldType.Start,
  DateFieldType.Created,
  DateFieldType.Done,
  DateFieldType.Cancelled,
];

/**
 * Creates a fresh copy of the default settings
 * This prevents shared mutable state between instances
 */
export function createDefaultSettings(): CalendarSettings {
  return {
    defaultView: "month",
    weekStart: 1, // Monday
    showCompleted: true,
    showEventCheckbox: false,
    moveOnComplete: false,
    completedSectionName: "Done",
    datePriority: [...DEFAULT_DATE_PRIORITY],
    recognizedDateFormat: "tasks",
    colors: {
      defaultEventColor: {
        light: "#6366f1", // Indigo 500
        dark: "#818cf8", // Indigo 400
      },
      colorRules: [],
      calendarSources: {},
    },
  };
}

/**
 * Default settings values (immutable reference for comparison)
 * @deprecated Use createDefaultSettings() for mutable copies
 */
export const DEFAULT_SETTINGS: CalendarSettings = createDefaultSettings();

/**
 * Settings tab for the Calendar plugin
 */
export class CalendarSettingsTab extends PluginSettingTab {
  plugin: CalendarPlugin;

  constructor(app: App, plugin: CalendarPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    // Calendar Settings heading
    new Setting(containerEl).setName("Calendar Settings").setHeading();

    // Default View
    new Setting(containerEl)
      .setName("Default view")
      .setDesc("The calendar view to display when opening a file.")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("month", "Month")
          .addOption("week", "Week")
          .addOption("day", "Day")
          .setValue(this.plugin.settings.defaultView)
          .onChange(async (value) => {
            this.plugin.settings.defaultView = value;
            await this.plugin.saveSettings();
          }),
      );

    // Week Start Day
    new Setting(containerEl)
      .setName("Week starts on")
      .setDesc("Choose which day the week starts on.")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("0", "Sunday")
          .addOption("1", "Monday")
          .setValue(String(this.plugin.settings.weekStart))
          .onChange(async (value) => {
            this.plugin.settings.weekStart = parseInt(value, 10);
            await this.plugin.saveSettings();
          }),
      );

    // Show Completed Tasks
    new Setting(containerEl)
      .setName("Show completed tasks")
      .setDesc("Display completed tasks in the calendar.")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.showCompleted)
          .onChange(async (value) => {
            this.plugin.settings.showCompleted = value;
            await this.plugin.saveSettings();
          }),
      );

    // Quick Completion section
    new Setting(containerEl)
      .setName("Quick Completion")
      .setDesc("Settings for quickly completing tasks from the calendar view.")
      .setHeading();

    // Show Event Checkbox
    new Setting(containerEl)
      .setName("Show checkbox on events")
      .setDesc(
        "Display a clickable checkbox on calendar events. " +
          "Click the checkbox to toggle completion, click elsewhere to edit.",
      )
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.showEventCheckbox)
          .onChange(async (value) => {
            this.plugin.settings.showEventCheckbox = value;
            await this.plugin.saveSettings();
          }),
      );

    // Move on Complete
    new Setting(containerEl)
      .setName("Move completed tasks")
      .setDesc(
        "Automatically move tasks to a specific section when marked as complete.",
      )
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.moveOnComplete)
          .onChange(async (value) => {
            this.plugin.settings.moveOnComplete = value;
            // Refresh display to show/hide dependent setting
            this.display();
            await this.plugin.saveSettings();
          }),
      );

    // Completed Section Name (only show when moveOnComplete is enabled)
    if (this.plugin.settings.moveOnComplete) {
      new Setting(containerEl)
        .setName("Completed tasks section")
        .setDesc(
          "The heading name (without #) to move completed tasks to. " +
            "Will be created as a level-2 heading (##) if it does not exist.",
        )
        .addText((text) =>
          text
            .setPlaceholder("Done")
            .setValue(this.plugin.settings.completedSectionName)
            .onChange(async (value) => {
              this.plugin.settings.completedSectionName =
                value.trim() || "Done";
              await this.plugin.saveSettings();
            }),
        );
    }

    // =================================================================
    // Appearance (Color) Settings
    // =================================================================
    new Setting(containerEl)
      .setName("Appearance")
      .setDesc("Customize event colors and conditional styling rules.")
      .setHeading();

    // Default Event Color
    this.renderDefaultColorSetting(containerEl);

    // Conditional Coloring Rules
    new Setting(containerEl)
      .setName("Conditional Coloring Rules")
      .setDesc(
        "Define rules to color events based on conditions. Rules are evaluated in order - first match wins.",
      )
      .addButton((btn) =>
        btn
          .setButtonText("Add Rule")
          .setCta()
          .onClick(async () => {
            await this.addNewRule();
          }),
      );

    // Rules list container
    const rulesContainer = containerEl.createDiv({
      cls: "calendar-color-rules-list",
    });
    this.renderRulesList(rulesContainer);

    // Date Format section
    new Setting(containerEl)
      .setName("Date Formats")
      .setDesc("Configure how dates are detected and prioritized.")
      .setHeading();

    // Recognized Format (single selection)
    new Setting(containerEl)
      .setName("Recognized format")
      .setDesc(
        "Select which date format pattern to recognize in your markdown files.",
      )
      .addDropdown((dropdown) =>
        dropdown
          .addOption("tasks", "Tasks (📅 2025-01-15)")
          .addOption("dataview", "Dataview ([due:: 2025-01-15])")
          .addOption("simple", "Simple (@ 2025-01-15)")
          .addOption("kanban", "Kanban (@{2025-01-15} @@{14:30})")
          .setValue(this.plugin.settings.recognizedDateFormat)
          .onChange(async (value) => {
            this.plugin.settings.recognizedDateFormat = value as DateFormatType;
            await this.plugin.saveSettings();
          }),
      );

    // Date Priority Order
    new Setting(containerEl)
      .setName("Date field priority")
      .setDesc(
        "When a task has multiple dates, which date type should be used for calendar display? " +
          "Drag to reorder. First item has highest priority.",
      )
      .addButton((btn) =>
        btn.setButtonText("Reset to default").onClick(async () => {
          this.plugin.settings.datePriority = [...DEFAULT_DATE_PRIORITY];
          await this.plugin.saveSettings();
          this.display();
        }),
      );

    // Create sortable list for date priority
    const priorityContainer = containerEl.createDiv({
      cls: "calendar-date-priority-list",
    });
    this.renderDatePriorityList(priorityContainer);

    // Help section
    new Setting(containerEl)
      .setName("Usage")
      .setDesc("Supported date formats for the calendar.")
      .setHeading();

    const helpDiv = containerEl.createDiv({ cls: "calendar-settings-help" });
    helpDiv.createEl("p", {
      text: "The calendar supports multiple date formats:",
    });

    const formatList = helpDiv.createEl("ul");

    // Tasks plugin emoji format
    const emojiItem = formatList.createEl("li");
    emojiItem.createEl("strong", { text: "Tasks plugin (emoji): " });
    emojiItem.createEl("code", { text: "📅 🛫 ⏳ ➕ ✅ ❌" });
    emojiItem.appendText(" followed by YYYY-MM-DD");

    // Dataview format
    const dataviewItem = formatList.createEl("li");
    dataviewItem.createEl("strong", { text: "Dataview inline fields: " });
    dataviewItem.createEl("code", { text: "[due:: 2025-01-15]" });
    dataviewItem.appendText(" or ");
    dataviewItem.createEl("code", { text: "(start:: 2025-01-15)" });

    // Simple format
    const simpleItem = formatList.createEl("li");
    simpleItem.createEl("strong", { text: "Simple format: " });
    simpleItem.createEl("code", { text: "@ 2025-01-15" });

    const codeBlock = helpDiv.createEl("pre");
    codeBlock.createEl("code", {
      text: `- [ ] Task with due date 📅 2025-01-15
- [ ] Task with start date 🛫 2025-01-10
- [ ] Task with scheduled ⏳ 2025-01-12
- [ ] Dataview style [due:: 2025-01-15]
- [ ] Simple format @ 2025-01-15`,
    });
  }

  /**
   * Renders the default color setting with dual color pickers
   */
  private renderDefaultColorSetting(containerEl: HTMLElement): void {
    const setting = new Setting(containerEl)
      .setName("Default Event Color")
      .setDesc("Base color for events that don't match any rules.");

    // Light mode color picker
    const lightContainer = setting.controlEl.createDiv({
      cls: "calendar-color-picker-group",
    });
    lightContainer.createSpan({ text: "Light", cls: "calendar-color-label" });
    const lightPicker = new ColorComponent(lightContainer);
    lightPicker.setValue(this.plugin.settings.colors.defaultEventColor.light);
    lightPicker.onChange(async (value) => {
      this.plugin.settings.colors.defaultEventColor.light = value;
      await this.plugin.saveSettings();
    });

    // Dark mode color picker
    const darkContainer = setting.controlEl.createDiv({
      cls: "calendar-color-picker-group",
    });
    darkContainer.createSpan({ text: "Dark", cls: "calendar-color-label" });
    const darkPicker = new ColorComponent(darkContainer);
    darkPicker.setValue(this.plugin.settings.colors.defaultEventColor.dark);
    darkPicker.onChange(async (value) => {
      this.plugin.settings.colors.defaultEventColor.dark = value;
      await this.plugin.saveSettings();
    });
  }

  /**
   * Adds a new color rule with default values
   */
  private async addNewRule(): Promise<void> {
    const newRule: ColorRule = {
      id: Date.now().toString(),
      enabled: true,
      name: "New Rule",
      conditionType: ColorConditionType.IsOverdue,
      color: {
        light: "#ef4444", // Red for overdue by default
        dark: "#f87171",
      },
    };

    this.plugin.settings.colors.colorRules.push(newRule);
    await this.plugin.saveSettings();
    this.display();
  }

  /**
   * Renders the list of color rules
   */
  private renderRulesList(container: HTMLElement): void {
    container.empty();

    const rules = this.plugin.settings.colors.colorRules;

    if (rules.length === 0) {
      container.createDiv({
        cls: "calendar-rules-empty",
        text: "No rules defined. Add a rule to customize event colors based on conditions.",
      });
      return;
    }

    rules.forEach((rule, index) => {
      this.renderRuleItem(container, rule, index);
    });
  }

  /**
   * Renders a single color rule item
   */
  private renderRuleItem(
    container: HTMLElement,
    rule: ColorRule,
    index: number,
  ): void {
    const ruleDiv = container.createDiv({ cls: "calendar-color-rule-item" });

    // Header row with toggle, name, and actions
    const headerRow = ruleDiv.createDiv({ cls: "calendar-rule-header" });

    // Enable toggle
    headerRow.createDiv({ cls: "calendar-rule-toggle" }, (el) => {
      new ToggleComponent(el).setValue(rule.enabled).onChange(async (value) => {
        const rules = this.plugin.settings.colors.colorRules;
        const ruleIndex = rules.findIndex((r) => r.id === rule.id);
        if (ruleIndex !== -1) {
          rules[ruleIndex].enabled = value;
        }
        await this.plugin.saveSettings();
      });
    });

    // Rule name input
    headerRow.createDiv({ cls: "calendar-rule-name-wrapper" }, (el) => {
      new TextComponent(el)
        .setPlaceholder("Rule name")
        .setValue(rule.name)
        .onChange(async (value) => {
          rule.name = value || "Unnamed Rule";
          await this.plugin.saveSettings();
        });
    });

    // Action buttons
    const actionsEl = headerRow.createDiv({ cls: "calendar-rule-actions" });

    // Move up button
    if (index > 0) {
      new ExtraButtonComponent(actionsEl)
        .setIcon("arrow-up")
        .setTooltip("Move up")
        .onClick(async () => {
          const rules = this.plugin.settings.colors.colorRules;
          [rules[index - 1], rules[index]] = [rules[index], rules[index - 1]];
          await this.plugin.saveSettings();
          this.display();
        });
    }

    // Move down button
    if (index < this.plugin.settings.colors.colorRules.length - 1) {
      new ExtraButtonComponent(actionsEl)
        .setIcon("arrow-down")
        .setTooltip("Move down")
        .onClick(async () => {
          const rules = this.plugin.settings.colors.colorRules;
          [rules[index], rules[index + 1]] = [rules[index + 1], rules[index]];
          await this.plugin.saveSettings();
          this.display();
        });
    }

    // Delete button
    const deleteBtn = new ExtraButtonComponent(actionsEl)
      .setIcon("trash")
      .setTooltip("Delete rule")
      .onClick(async () => {
        this.plugin.settings.colors.colorRules.splice(index, 1);
        await this.plugin.saveSettings();
        this.display();
      });
    deleteBtn.extraSettingsEl.addClass("calendar-rule-btn-danger");

    // Condition row
    const conditionRow = ruleDiv.createDiv({ cls: "calendar-rule-condition" });

    // Condition type dropdown
    conditionRow.createDiv({ cls: "calendar-rule-type-wrapper" }, (el) => {
      const dropdown = new DropdownComponent(el);
      Object.values(ColorConditionType).forEach((type) => {
        dropdown.addOption(type, getConditionTypeLabel(type));
      });
      dropdown.setValue(rule.conditionType).onChange(async (value) => {
        rule.conditionType = value as ColorConditionType;
        // Clear value if condition doesn't need it
        if (!conditionRequiresValue(rule.conditionType)) {
          rule.conditionValue = undefined;
        }
        await this.plugin.saveSettings();
        this.display();
      });
    });

    // Condition value input (only for certain condition types)
    if (conditionRequiresValue(rule.conditionType)) {
      conditionRow.createDiv({ cls: "calendar-rule-value-wrapper" }, (el) => {
        new TextComponent(el)
          .setPlaceholder(this.getValuePlaceholder(rule.conditionType))
          .setValue(rule.conditionValue || "")
          .onChange(async (value) => {
            rule.conditionValue = value;
            await this.plugin.saveSettings();
          });
      });
    }

    // Color row
    const colorRow = ruleDiv.createDiv({ cls: "calendar-rule-colors" });

    // Light mode color
    const lightGroup = colorRow.createDiv({
      cls: "calendar-color-picker-group",
    });
    lightGroup.createSpan({ text: "Light", cls: "calendar-color-label" });
    new ColorComponent(lightGroup)
      .setValue(rule.color.light)
      .onChange(async (value) => {
        rule.color.light = value;
        await this.plugin.saveSettings();
      });

    // Dark mode color
    const darkGroup = colorRow.createDiv({
      cls: "calendar-color-picker-group",
    });
    darkGroup.createSpan({ text: "Dark", cls: "calendar-color-label" });
    new ColorComponent(darkGroup)
      .setValue(rule.color.dark)
      .onChange(async (value) => {
        rule.color.dark = value;
        await this.plugin.saveSettings();
      });
  }

  /**
   * Gets placeholder text for condition value input
   */
  private getValuePlaceholder(type: ColorConditionType): string {
    switch (type) {
      case ColorConditionType.HasTag:
        return "#tag or tag";
      case ColorConditionType.TitleContains:
        return "Search text...";
      case ColorConditionType.SectionIs:
        return "Section name";
      default:
        return "Value...";
    }
  }

  /**
   * Renders the sortable date priority list
   */
  private renderDatePriorityList(container: HTMLElement): void {
    container.empty();

    const list = container.createEl("div", { cls: "calendar-priority-items" });

    this.plugin.settings.datePriority.forEach((type, index) => {
      const item = list.createDiv({ cls: "calendar-priority-item" });

      // Drag handle
      item.createSpan({ cls: "calendar-priority-handle" }, (el) => {
        setIcon(el, "grip-vertical");
      });

      // Priority number
      item.createSpan({
        cls: "calendar-priority-number",
        text: `${index + 1}.`,
      });

      // Type label
      item.createSpan({
        cls: "calendar-priority-label",
        text: getDateTypeLabel(type),
      });

      // Move up button
      if (index > 0) {
        new ExtraButtonComponent(item)
          .setIcon("arrow-up")
          .setTooltip("Move up")
          .onClick(async () => {
            this.swapPriority(index, index - 1);
            await this.plugin.saveSettings();
            this.renderDatePriorityList(container);
          });
      }

      // Move down button
      if (index < this.plugin.settings.datePriority.length - 1) {
        new ExtraButtonComponent(item)
          .setIcon("arrow-down")
          .setTooltip("Move down")
          .onClick(async () => {
            this.swapPriority(index, index + 1);
            await this.plugin.saveSettings();
            this.renderDatePriorityList(container);
          });
      }
    });
  }

  /**
   * Swaps two items in the priority list
   */
  private swapPriority(indexA: number, indexB: number): void {
    const priority = this.plugin.settings.datePriority;
    [priority[indexA], priority[indexB]] = [priority[indexB], priority[indexA]];
  }
}
