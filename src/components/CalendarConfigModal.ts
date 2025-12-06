/**
 * Calendar Configuration Modal
 * Allows per-file color configuration for calendars
 */
import {
  App,
  Modal,
  Setting,
  TFile,
  ColorComponent,
  Notice,
  ToggleComponent,
  TextComponent,
  DropdownComponent,
  setIcon,
  ExtraButtonComponent,
  ButtonComponent,
} from "obsidian";
import type CalendarPlugin from "../main";
import type { ColorTheme, ColorRule } from "../types/colorTypes";
import {
  ColorConditionType,
  getConditionTypeLabel,
  conditionRequiresValue,
} from "../types/colorTypes";
import { ColorService } from "../services/ColorService";

/**
 * Section info for color configuration
 */
export interface SectionInfo {
  id: string;
  name: string;
}

/**
 * Modal for configuring calendar-specific color settings
 */
export class CalendarConfigModal extends Modal {
  private plugin: CalendarPlugin;
  private file: TFile;
  private sections: SectionInfo[];
  private onSettingsChanged: () => void;

  constructor(
    app: App,
    plugin: CalendarPlugin,
    file: TFile,
    onSettingsChanged: () => void,
    sections: SectionInfo[] = [],
  ) {
    super(app);
    this.plugin = plugin;
    this.file = file;
    this.sections = sections;
    this.onSettingsChanged = onSettingsChanged;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("calendar-config-modal");

    // Title
    contentEl.createEl("h2", { text: `Color Settings` });
    contentEl.createEl("p", {
      cls: "calendar-config-subtitle",
      text: this.file.basename,
    });

    // Get current config for this file
    const filePath = this.file.path;
    const sourceConfig =
      this.plugin.settings.colors.calendarSources[filePath] || {};

    // Base Color Section
    new Setting(contentEl)
      .setName("Calendar Base Color")
      .setDesc(
        "Custom color for all events in this calendar (overrides global default).",
      )
      .setHeading();

    // Enable/disable custom color
    const hasCustomColor = !!sourceConfig.color;

    new Setting(contentEl)
      .setName("Use custom color")
      .setDesc("Enable to set a specific color for this calendar.")
      .addToggle((toggle) =>
        toggle.setValue(hasCustomColor).onChange(async (value) => {
          if (value) {
            // Enable custom color with random initial color
            const randomColor = ColorService.generateRandomColorTheme();
            this.ensureSourceConfig(filePath);
            this.plugin.settings.colors.calendarSources[filePath].color =
              randomColor;
          } else {
            // Disable custom color
            if (this.plugin.settings.colors.calendarSources[filePath]) {
              delete this.plugin.settings.colors.calendarSources[filePath]
                .color;
              // Clean up empty config
              if (
                Object.keys(
                  this.plugin.settings.colors.calendarSources[filePath],
                ).length === 0
              ) {
                delete this.plugin.settings.colors.calendarSources[filePath];
              }
            }
          }
          await this.plugin.saveSettings();
          this.onSettingsChanged();
          this.onOpen(); // Refresh modal
        }),
      );

    // Color pickers (only show when custom color is enabled)
    if (hasCustomColor && sourceConfig.color) {
      this.renderColorPickers(contentEl, filePath, sourceConfig.color);
    }

    // Section Colors Section (only show if there are multiple sections)
    if (this.sections.length > 1) {
      new Setting(contentEl)
        .setName("Section Colors")
        .setDesc(
          "Set custom colors for each section. These colors are used in 'All Calendars' view.",
        )
        .setHeading();

      this.renderSectionColors(
        contentEl,
        filePath,
        sourceConfig.sectionColors || {},
      );
    }

    // File-specific Rules Section
    new Setting(contentEl)
      .setName("File-specific Rules")
      .setDesc("Color rules that only apply to this calendar file.")
      .setHeading();

    // Get rules specific to this file
    const fileRules = this.plugin.settings.colors.colorRules.filter((rule) =>
      rule.applyToFiles?.includes(filePath),
    );

    new Setting(contentEl).setName("Add rule for this file").addButton((btn) =>
      btn
        .setButtonText("Add Rule")
        .setCta()
        .onClick(async () => {
          await this.addFileSpecificRule(filePath);
        }),
    );

    // Render file-specific rules
    if (fileRules.length > 0) {
      const rulesContainer = contentEl.createDiv({
        cls: "calendar-file-rules-list",
      });
      this.renderFileRules(rulesContainer, fileRules, filePath);
    } else {
      contentEl.createDiv({
        cls: "calendar-rules-empty",
        text: "No file-specific rules. Add a rule to customize colors for this calendar only.",
      });
    }

    // Action buttons
    const buttonRow = contentEl.createDiv({ cls: "calendar-config-buttons" });

    new Setting(buttonRow)
      .addButton((btn) =>
        btn
          .setButtonText("Reset to Global")
          .setWarning()
          .onClick(async () => {
            await this.resetToGlobal(filePath);
          }),
      )
      .addButton((btn) =>
        btn.setButtonText("Close").onClick(() => {
          this.close();
        }),
      );
  }

  /**
   * Renders the color picker controls
   */
  private renderColorPickers(
    containerEl: HTMLElement,
    filePath: string,
    color: ColorTheme,
  ): void {
    const colorRow = containerEl.createDiv({
      cls: "calendar-config-color-row",
    });

    // Light mode color
    const lightGroup = colorRow.createDiv({
      cls: "calendar-color-picker-group",
    });
    lightGroup.createSpan({ text: "Light Mode", cls: "calendar-color-label" });
    const lightPicker = new ColorComponent(lightGroup);
    lightPicker.setValue(color.light);
    lightPicker.onChange(async (value) => {
      this.ensureSourceConfig(filePath);
      if (this.plugin.settings.colors.calendarSources[filePath].color) {
        this.plugin.settings.colors.calendarSources[filePath].color!.light =
          value;
        await this.plugin.saveSettings();
        this.onSettingsChanged();
      }
    });

    // Dark mode color
    const darkGroup = colorRow.createDiv({
      cls: "calendar-color-picker-group",
    });
    darkGroup.createSpan({ text: "Dark Mode", cls: "calendar-color-label" });
    const darkPicker = new ColorComponent(darkGroup);
    darkPicker.setValue(color.dark);
    darkPicker.onChange(async (value) => {
      this.ensureSourceConfig(filePath);
      if (this.plugin.settings.colors.calendarSources[filePath].color) {
        this.plugin.settings.colors.calendarSources[filePath].color!.dark =
          value;
        await this.plugin.saveSettings();
        this.onSettingsChanged();
      }
    });
  }

  /**
   * Renders section color configuration
   */
  private renderSectionColors(
    containerEl: HTMLElement,
    filePath: string,
    sectionColors: Record<string, ColorTheme>,
  ): void {
    const sectionsContainer = containerEl.createDiv({
      cls: "calendar-section-colors-list",
    });

    // Filter out the Default section if it's empty (following same pattern as menu)
    const visibleSections = this.sections.filter(
      (s) => s.id !== "Default" || this.sections.length <= 1,
    );

    visibleSections.forEach((section) => {
      const sectionColor = sectionColors[section.id];
      const hasColor = !!sectionColor;

      // Generate preview color (deterministic hash if no custom color)
      const isDarkMode = document.body.classList.contains("theme-dark");
      const previewColor = hasColor
        ? isDarkMode
          ? sectionColor.dark
          : sectionColor.light
        : ColorService.hashStringToColor(section.id, isDarkMode);

      const sectionRow = sectionsContainer.createDiv({
        cls: "calendar-section-color-item",
      });

      // Color preview dot
      const previewDot = sectionRow.createDiv({
        cls: "calendar-section-color-preview",
      });
      previewDot.style.backgroundColor = previewColor;

      // Section name
      sectionRow.createSpan({
        text: section.name,
        cls: "calendar-section-color-name",
      });

      // Color pickers (only show when custom color is set)
      if (hasColor) {
        const colorGroup = sectionRow.createDiv({
          cls: "calendar-section-color-pickers",
        });

        // Light picker
        new ColorComponent(colorGroup)
          .setValue(sectionColor.light)
          .onChange(async (value) => {
            this.ensureSourceConfig(filePath);
            this.ensureSectionColors(filePath);
            this.plugin.settings.colors.calendarSources[
              filePath
            ].sectionColors![section.id].light = value;
            await this.plugin.saveSettings();
            this.onSettingsChanged();
            // Update preview
            const newPreviewColor = isDarkMode ? sectionColor.dark : value;
            previewDot.style.backgroundColor = newPreviewColor;
          });

        // Dark picker
        new ColorComponent(colorGroup)
          .setValue(sectionColor.dark)
          .onChange(async (value) => {
            this.ensureSourceConfig(filePath);
            this.ensureSectionColors(filePath);
            this.plugin.settings.colors.calendarSources[
              filePath
            ].sectionColors![section.id].dark = value;
            await this.plugin.saveSettings();
            this.onSettingsChanged();
            // Update preview
            const newPreviewColor = isDarkMode ? value : sectionColor.light;
            previewDot.style.backgroundColor = newPreviewColor;
          });

        // Remove button
        new ExtraButtonComponent(sectionRow)
          .setIcon("x")
          .setTooltip("Remove custom color")
          .onClick(async () => {
            if (
              this.plugin.settings.colors.calendarSources[filePath]
                ?.sectionColors
            ) {
              delete this.plugin.settings.colors.calendarSources[filePath]
                .sectionColors![section.id];
              // Clean up empty sectionColors
              if (
                Object.keys(
                  this.plugin.settings.colors.calendarSources[filePath]
                    .sectionColors!,
                ).length === 0
              ) {
                delete this.plugin.settings.colors.calendarSources[filePath]
                  .sectionColors;
              }
              await this.plugin.saveSettings();
              this.onSettingsChanged();
              this.onOpen(); // Refresh modal
            }
          });
      } else {
        // Add color button
        new ButtonComponent(sectionRow)
          .setButtonText("Set Color")
          .setClass("calendar-section-color-add")
          .onClick(async () => {
            this.ensureSourceConfig(filePath);
            this.ensureSectionColors(filePath);
            // Initialize with the deterministic color as starting point
            const hslLight = ColorService.hashStringToColor(section.id, false);
            const hslDark = ColorService.hashStringToColor(section.id, true);
            this.plugin.settings.colors.calendarSources[
              filePath
            ].sectionColors![section.id] = {
              light: hslLight,
              dark: hslDark,
            };
            await this.plugin.saveSettings();
            this.onSettingsChanged();
            this.onOpen(); // Refresh modal
          });
      }
    });
  }

  /**
   * Ensures sectionColors object exists for file path
   */
  private ensureSectionColors(filePath: string): void {
    if (!this.plugin.settings.colors.calendarSources[filePath].sectionColors) {
      this.plugin.settings.colors.calendarSources[filePath].sectionColors = {};
    }
  }

  /**
   * Renders file-specific rules
   */
  private renderFileRules(
    container: HTMLElement,
    rules: ColorRule[],
    filePath: string,
  ): void {
    container.empty();

    rules.forEach((rule) => {
      const ruleIndex = this.plugin.settings.colors.colorRules.indexOf(rule);
      if (ruleIndex === -1) return;

      const ruleDiv = container.createDiv({ cls: "calendar-color-rule-item" });

      // Header with name and delete
      const headerRow = ruleDiv.createDiv({ cls: "calendar-rule-header" });

      // Enable toggle
      headerRow.createDiv({ cls: "calendar-rule-toggle" }, (el) => {
        new ToggleComponent(el)
          .setValue(rule.enabled)
          .onChange(async (value) => {
            rule.enabled = value;
            await this.plugin.saveSettings();
            this.onSettingsChanged();
          });
      });

      // Rule name
      headerRow.createDiv({ cls: "calendar-rule-name-wrapper" }, (el) => {
        new TextComponent(el)
          .setValue(rule.name)
          .setPlaceholder("Rule name")
          .onChange(async (value) => {
            rule.name = value || "Unnamed Rule";
            await this.plugin.saveSettings();
          });
      });

      // Delete button
      const deleteBtn = new ExtraButtonComponent(headerRow)
        .setIcon("trash")
        .setTooltip("Delete rule")
        .onClick(async () => {
          this.plugin.settings.colors.colorRules.splice(ruleIndex, 1);
          await this.plugin.saveSettings();
          this.onSettingsChanged();
          this.onOpen(); // Refresh modal
        });
      deleteBtn.extraSettingsEl.addClass("calendar-rule-btn-danger");

      // Condition row
      const conditionRow = ruleDiv.createDiv({
        cls: "calendar-rule-condition",
      });

      // Condition type
      conditionRow.createDiv({ cls: "calendar-rule-type-wrapper" }, (el) => {
        const dropdown = new DropdownComponent(el);
        Object.values(ColorConditionType).forEach((type) => {
          dropdown.addOption(type, getConditionTypeLabel(type));
        });
        dropdown.setValue(rule.conditionType).onChange(async (value) => {
          rule.conditionType = value as ColorConditionType;
          if (!conditionRequiresValue(rule.conditionType)) {
            rule.conditionValue = undefined;
          }
          await this.plugin.saveSettings();
          this.onSettingsChanged();
          this.onOpen();
        });
      });

      // Condition value (if needed)
      if (conditionRequiresValue(rule.conditionType)) {
        conditionRow.createDiv({ cls: "calendar-rule-value-wrapper" }, (el) => {
          new TextComponent(el)
            .setValue(rule.conditionValue || "")
            .setPlaceholder(this.getValuePlaceholder(rule.conditionType))
            .onChange(async (value) => {
              rule.conditionValue = value;
              await this.plugin.saveSettings();
              this.onSettingsChanged();
            });
        });
      }

      // Color row
      const colorRow = ruleDiv.createDiv({ cls: "calendar-rule-colors" });

      // Light color
      const lightGroup = colorRow.createDiv({
        cls: "calendar-color-picker-group",
      });
      lightGroup.createSpan({ text: "Light", cls: "calendar-color-label" });
      new ColorComponent(lightGroup)
        .setValue(rule.color.light)
        .onChange(async (value) => {
          rule.color.light = value;
          await this.plugin.saveSettings();
          this.onSettingsChanged();
        });

      // Dark color
      const darkGroup = colorRow.createDiv({
        cls: "calendar-color-picker-group",
      });
      darkGroup.createSpan({ text: "Dark", cls: "calendar-color-label" });
      new ColorComponent(darkGroup)
        .setValue(rule.color.dark)
        .onChange(async (value) => {
          rule.color.dark = value;
          await this.plugin.saveSettings();
          this.onSettingsChanged();
        });
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
   * Adds a new file-specific rule
   */
  private async addFileSpecificRule(filePath: string): Promise<void> {
    const newRule: ColorRule = {
      id: Date.now().toString(),
      enabled: true,
      name: "New Rule",
      conditionType: ColorConditionType.IsOverdue,
      color: {
        light: "#ef4444",
        dark: "#f87171",
      },
      applyToFiles: [filePath],
    };

    this.plugin.settings.colors.colorRules.push(newRule);
    await this.plugin.saveSettings();
    this.onSettingsChanged();
    this.onOpen(); // Refresh modal
  }

  /**
   * Resets all file-specific settings
   */
  private async resetToGlobal(filePath: string): Promise<void> {
    // Remove file-specific color
    if (this.plugin.settings.colors.calendarSources[filePath]) {
      delete this.plugin.settings.colors.calendarSources[filePath];
    }

    // Remove file-specific rules
    this.plugin.settings.colors.colorRules =
      this.plugin.settings.colors.colorRules.filter(
        (rule) => !rule.applyToFiles?.includes(filePath),
      );

    await this.plugin.saveSettings();
    this.onSettingsChanged();
    new Notice("Reset to global settings");
    this.close();
  }

  /**
   * Ensures source config exists for file path
   */
  private ensureSourceConfig(filePath: string): void {
    if (!this.plugin.settings.colors.calendarSources[filePath]) {
      this.plugin.settings.colors.calendarSources[filePath] = {};
    }
  }

  onClose(): void {
    const { contentEl } = this;
    contentEl.empty();
  }
}
