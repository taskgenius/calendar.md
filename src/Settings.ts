import { App, PluginSettingTab, Setting, setIcon } from 'obsidian';

import type CalendarPlugin from './main';
import { DateFieldType, getDateTypeLabel, type DateFormatType } from './parsers/dateParser';

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
 * Default settings values
 */
export const DEFAULT_SETTINGS: CalendarSettings = {
  defaultView: 'month',
  weekStart: 1, // Monday
  showCompleted: true,
  showEventCheckbox: false,
  moveOnComplete: false,
  completedSectionName: 'Done',
  datePriority: DEFAULT_DATE_PRIORITY,
  recognizedDateFormat: 'tasks',
};

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
    new Setting(containerEl)
      .setName('Calendar Settings')
      .setHeading();

    // Default View
    new Setting(containerEl)
      .setName('Default view')
      .setDesc('The calendar view to display when opening a file.')
      .addDropdown((dropdown) =>
        dropdown
          .addOption('month', 'Month')
          .addOption('week', 'Week')
          .addOption('day', 'Day')
          .setValue(this.plugin.settings.defaultView)
          .onChange(async (value) => {
            this.plugin.settings.defaultView = value;
            await this.plugin.saveSettings();
          })
      );

    // Week Start Day
    new Setting(containerEl)
      .setName('Week starts on')
      .setDesc('Choose which day the week starts on.')
      .addDropdown((dropdown) =>
        dropdown
          .addOption('0', 'Sunday')
          .addOption('1', 'Monday')
          .setValue(String(this.plugin.settings.weekStart))
          .onChange(async (value) => {
            this.plugin.settings.weekStart = parseInt(value, 10);
            await this.plugin.saveSettings();
          })
      );

    // Show Completed Tasks
    new Setting(containerEl)
      .setName('Show completed tasks')
      .setDesc('Display completed tasks in the calendar.')
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.showCompleted)
          .onChange(async (value) => {
            this.plugin.settings.showCompleted = value;
            await this.plugin.saveSettings();
          })
      );

    // Quick Completion section
    new Setting(containerEl)
      .setName('Quick Completion')
      .setDesc('Settings for quickly completing tasks from the calendar view.')
      .setHeading();

    // Show Event Checkbox
    new Setting(containerEl)
      .setName('Show checkbox on events')
      .setDesc(
        'Display a clickable checkbox on calendar events. ' +
        'Click the checkbox to toggle completion, click elsewhere to edit.'
      )
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.showEventCheckbox)
          .onChange(async (value) => {
            this.plugin.settings.showEventCheckbox = value;
            await this.plugin.saveSettings();
          })
      );

    // Move on Complete
    new Setting(containerEl)
      .setName('Move completed tasks')
      .setDesc('Automatically move tasks to a specific section when marked as complete.')
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.moveOnComplete)
          .onChange(async (value) => {
            this.plugin.settings.moveOnComplete = value;
            // Refresh display to show/hide dependent setting
            this.display();
            await this.plugin.saveSettings();
          })
      );

    // Completed Section Name (only show when moveOnComplete is enabled)
    if (this.plugin.settings.moveOnComplete) {
      new Setting(containerEl)
        .setName('Completed tasks section')
        .setDesc(
          'The heading name (without #) to move completed tasks to. ' +
          'Will be created as a level-2 heading (##) if it does not exist.'
        )
        .addText((text) =>
          text
            .setPlaceholder('Done')
            .setValue(this.plugin.settings.completedSectionName)
            .onChange(async (value) => {
              this.plugin.settings.completedSectionName = value.trim() || 'Done';
              await this.plugin.saveSettings();
            })
        );
    }

    // Date Format section
    new Setting(containerEl)
      .setName('Date Formats')
      .setDesc('Configure how dates are detected and prioritized.')
      .setHeading();

    // Recognized Format (single selection)
    new Setting(containerEl)
      .setName('Recognized format')
      .setDesc('Select which date format pattern to recognize in your markdown files.')
      .addDropdown((dropdown) =>
        dropdown
          .addOption('tasks', 'Tasks (📅 2025-01-15)')
          .addOption('dataview', 'Dataview ([due:: 2025-01-15])')
          .addOption('simple', 'Simple (@ 2025-01-15)')
          .addOption('kanban', 'Kanban (@{2025-01-15} @@{14:30})')
          .setValue(this.plugin.settings.recognizedDateFormat)
          .onChange(async (value) => {
            this.plugin.settings.recognizedDateFormat = value as DateFormatType;
            await this.plugin.saveSettings();
          })
      );

    // Date Priority Order
    new Setting(containerEl)
      .setName('Date field priority')
      .setDesc(
        'When a task has multiple dates, which date type should be used for calendar display? ' +
        'Drag to reorder. First item has highest priority.'
      )
      .addButton((btn) =>
        btn
          .setButtonText('Reset to default')
          .onClick(async () => {
            this.plugin.settings.datePriority = [...DEFAULT_DATE_PRIORITY];
            await this.plugin.saveSettings();
            this.display();
          })
      );

    // Create sortable list for date priority
    const priorityContainer = containerEl.createDiv({ cls: 'calendar-date-priority-list' });
    this.renderDatePriorityList(priorityContainer);

    // Help section
    new Setting(containerEl)
      .setName('Usage')
      .setDesc('Supported date formats for the calendar.')
      .setHeading();

    const helpDiv = containerEl.createDiv({ cls: 'calendar-settings-help' });
    helpDiv.createEl('p', {
      text: 'The calendar supports multiple date formats:',
    });

    const formatList = helpDiv.createEl('ul');

    // Tasks plugin emoji format
    const emojiItem = formatList.createEl('li');
    emojiItem.createEl('strong', { text: 'Tasks plugin (emoji): ' });
    emojiItem.createEl('code', { text: '📅 🛫 ⏳ ➕ ✅ ❌' });
    emojiItem.appendText(' followed by YYYY-MM-DD');

    // Dataview format
    const dataviewItem = formatList.createEl('li');
    dataviewItem.createEl('strong', { text: 'Dataview inline fields: ' });
    dataviewItem.createEl('code', { text: '[due:: 2025-01-15]' });
    dataviewItem.appendText(' or ');
    dataviewItem.createEl('code', { text: '(start:: 2025-01-15)' });

    // Simple format
    const simpleItem = formatList.createEl('li');
    simpleItem.createEl('strong', { text: 'Simple format: ' });
    simpleItem.createEl('code', { text: '@ 2025-01-15' });

    const codeBlock = helpDiv.createEl('pre');
    codeBlock.createEl('code', {
      text: `- [ ] Task with due date 📅 2025-01-15
- [ ] Task with start date 🛫 2025-01-10
- [ ] Task with scheduled ⏳ 2025-01-12
- [ ] Dataview style [due:: 2025-01-15]
- [ ] Simple format @ 2025-01-15`,
    });
  }

  /**
   * Renders the sortable date priority list
   */
  private renderDatePriorityList(container: HTMLElement): void {
    container.empty();

    const list = container.createEl('div', { cls: 'calendar-priority-items' });

    this.plugin.settings.datePriority.forEach((type, index) => {
      const item = list.createDiv({ cls: 'calendar-priority-item' });

      // Drag handle
      item.createSpan({ cls: 'calendar-priority-handle' }, (el)=> {
        setIcon(el, "grip-vertical");
      });

      // Priority number
      item.createSpan({ cls: 'calendar-priority-number', text: `${index + 1}.` });

      // Type label
      item.createSpan({ cls: 'calendar-priority-label', text: getDateTypeLabel(type) });

      // Move up button
      if (index > 0) {
        const upBtn = item.createEl('span', { cls: ['calendar-priority-btn', 'clickable-icon'] }, (el)=> {
          setIcon(el, "arrow-up");
        });
        upBtn.addEventListener('click', async () => {
          this.swapPriority(index, index - 1);
          await this.plugin.saveSettings();
          this.renderDatePriorityList(container);
        });
      }

      // Move down button
      if (index < this.plugin.settings.datePriority.length - 1) {
        const downBtn = item.createEl('span', { cls: ['calendar-priority-btn', 'clickable-icon'] }, (el)=> {
          setIcon(el, "arrow-down");
        });
        downBtn.addEventListener('click', async () => {
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
