import {
  TextFileView,
  WorkspaceLeaf,
  TFile,
  Notice,
  debounce,
  Modal,
  App,
  Setting,
  TextComponent,
  ButtonComponent,
  ToggleComponent,
  setIcon,
  Menu,
  moment,
  ViewStateResult,
} from "obsidian";
import { Calendar } from "@taskgenius/calendar";
import { MomentAdapter } from "@taskgenius/calendar/moment";
import type { CalendarEvent } from "@taskgenius/calendar";

import type CalendarPlugin from "./main";
import {
  extractAllDates,
  getPrimaryDate,
  stripDates,
  formatDate,
  hasTimeComponent,
  DateFieldType,
  type ParsedDateField,
  type DateFormatType,
} from "./parsers/dateParser";

export const VIEW_TYPE_CALENDAR = "calendar-md-view";

/** Frontmatter key for calendar files */
export const FRONTMATTER_KEY = "calendar-plugin";

/** Basic frontmatter template for new calendar files */
export const BASIC_FRONTMATTER = `---
calendar-plugin: basic
---

`;

/** View type options */
type ViewType = "month" | "week" | "day";

/**
 * Represents a parsed task line from markdown
 */
interface TaskLine {
  /** Unique identifier (line index as string) */
  id: string;
  /** Original line index in the file */
  lineIndex: number;
  /** Original markdown content */
  markdown: string;
  /** Extracted task title (without date metadata) */
  title: string;
  /** Primary parsed date (for calendar display) */
  date: moment.Moment;
  /** Type of the primary date field */
  dateType: DateFieldType;
  /** All parsed date fields from this line */
  allDates: ParsedDateField[];
  /** Whether the date has specific time (for Kanban format) */
  hasTime?: boolean;
  /** Whether the date is in Kanban format (disables resize) */
  isKanban?: boolean;
  /** Whether the task is completed */
  completed: boolean;
  /** Section this task belongs to */
  sectionId: string;
}

/**
 * Represents a section of the document (grouped by Heading)
 */
interface CalendarSection {
  /** Section ID (heading text or 'Default') */
  id: string;
  /** Display name for the section */
  name: string;
  /** Heading level (1 for #, 2 for ##, 0 for Default) */
  level: number;
  /** Parent section ID (for hierarchical structure) */
  parentId: string | null;
  /** Line number where section starts */
  startLine: number;
  /** Line number where section ends (exclusive) */
  endLine: number;
  /** Tasks within this section */
  tasks: TaskLine[];
}

/** Default section ID for tasks without heading */
const DEFAULT_SECTION_ID = "Default";

/**
 * Checks if content has the calendar frontmatter key
 */
export function hasCalendarFrontmatter(content: string): boolean {
  const frontmatterMatch = content.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!frontmatterMatch) return false;
  return frontmatterMatch[1].includes(FRONTMATTER_KEY);
}

/**
 * Popover component for editing task details.
 * Displays at click position and allows editing title, date, and completion status.
 */
class TaskPopover {
  private containerEl: HTMLElement;
  private titleInput: TextComponent | null = null;
  private dateInput: TextComponent | null = null;
  private completedToggle: ToggleComponent | null = null;

  constructor(
    private task: TaskLine,
    private position: { x: number; y: number },
    private onSave: (
      id: string,
      updates: Partial<Pick<TaskLine, "title" | "date" | "completed">>,
    ) => void,
    private onDelete: (id: string) => void,
    private onJumpToLine: (lineIndex: number) => void,
  ) {
    this.containerEl = document.body.createDiv({
      cls: "calendar-task-popover",
    });
    this.render();
    this.positionPopover();

    // Delay event listener registration to prevent immediate close from triggering click
    setTimeout(() => {
      document.addEventListener("mousedown", this.handleOutsideClick);
      document.addEventListener("keydown", this.handleKeydown);
    }, 10);
  }

  /**
   * Positions the popover near the click point, adjusting for viewport boundaries.
   */
  private positionPopover(): void {
    const rect = this.containerEl.getBoundingClientRect();
    const padding = 16;

    let top = this.position.y;
    let left = this.position.x;

    // Adjust if popover would overflow right edge
    if (left + rect.width + padding > window.innerWidth) {
      left = window.innerWidth - rect.width - padding;
    }

    // Adjust if popover would overflow bottom edge
    if (top + rect.height + padding > window.innerHeight) {
      top = window.innerHeight - rect.height - padding;
    }

    // Ensure minimum position
    left = Math.max(padding, left);
    top = Math.max(padding, top);

    this.containerEl.style.top = `${top}px`;
    this.containerEl.style.left = `${left}px`;
  }

  /**
   * Renders the popover content with form controls.
   */
  private render(): void {
    // Header with task info
    const header = this.containerEl.createDiv({
      cls: "calendar-popover-header",
    });
    header.createSpan({ text: "Edit Task", cls: "calendar-popover-title" });

    // Title input
    const titleRow = this.containerEl.createDiv({
      cls: "calendar-popover-row",
    });
    titleRow.createSpan({ text: "Title", cls: "calendar-popover-label" });
    this.titleInput = new TextComponent(titleRow)
      .setValue(this.task.title)
      .setPlaceholder("Task title");
    this.titleInput.inputEl.addClass("calendar-popover-input");

    // Date input
    const dateRow = this.containerEl.createDiv({ cls: "calendar-popover-row" });
    dateRow.createSpan({ text: "Date", cls: "calendar-popover-label" });
    this.dateInput = new TextComponent(dateRow).setValue(
      this.task.date.format("YYYY-MM-DD"),
    );
    this.dateInput.inputEl.type = "date";
    this.dateInput.inputEl.addClass("calendar-popover-input");

    // Completed toggle
    const completedRow = this.containerEl.createDiv({
      cls: "calendar-popover-row",
    });
    completedRow.createSpan({
      text: "Completed",
      cls: "calendar-popover-label",
    });
    this.completedToggle = new ToggleComponent(completedRow).setValue(
      this.task.completed,
    );

    // Buttons row
    const buttonRow = this.containerEl.createDiv({
      cls: "calendar-popover-buttons",
    });

    new ButtonComponent(buttonRow)
      .setButtonText("Go to Line")
      .setIcon("file-text")
      .onClick(() => {
        this.onJumpToLine(this.task.lineIndex);
        this.close();
      });

    new ButtonComponent(buttonRow)
      .setButtonText("Delete")
      .setWarning()
      .onClick(() => {
        this.onDelete(this.task.id);
        this.close();
      });

    new ButtonComponent(buttonRow)
      .setButtonText("Save")
      .setCta()
      .onClick(() => this.save());
  }

  /**
   * Saves the edited task data.
   */
  private save(): void {
    if (!this.titleInput || !this.dateInput || !this.completedToggle) return;

    const newTitle = this.titleInput.getValue().trim();
    const newDateStr = this.dateInput.getValue();
    const newDate = moment(newDateStr);

    if (!newTitle) {
      new Notice("Task title cannot be empty");
      return;
    }

    if (!newDate.isValid()) {
      new Notice("Invalid date format");
      return;
    }

    this.onSave(this.task.id, {
      title: newTitle,
      date: newDate,
      completed: this.completedToggle.getValue(),
    });

    this.close();
  }

  /**
   * Handles clicks outside the popover to close it.
   */
  private handleOutsideClick = (e: MouseEvent): void => {
    if (!this.containerEl.contains(e.target as Node)) {
      this.close();
    }
  };

  /**
   * Handles keyboard events (Escape to close, Enter to save).
   */
  private handleKeydown = (e: KeyboardEvent): void => {
    if (e.key === "Escape") {
      this.close();
    } else if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      this.save();
    }
  };

  /**
   * Closes and removes the popover from DOM.
   */
  close(): void {
    document.removeEventListener("mousedown", this.handleOutsideClick);
    document.removeEventListener("keydown", this.handleKeydown);
    this.containerEl.remove();
  }
}

/**
 * CalendarView - Main view component for displaying markdown tasks in a calendar format.
 * Extends TextFileView for proper file integration with Obsidian.
 * Supports month, week, and day views with drag-and-drop rescheduling.
 */
export class CalendarView extends TextFileView {
  public calendar: Calendar | null = null;
  private plugin: CalendarPlugin;

  /** Global map of all tasks by ID for quick lookup */
  private currentEvents: Map<string, TaskLine> = new Map();
  /** Map of sections parsed from the document */
  private sections: Map<string, CalendarSection> = new Map();
  /** Currently active/displayed section */
  private activeSectionId: string = DEFAULT_SECTION_ID;

  private toolbarEl: HTMLElement | null = null;
  private dateDisplayEl: HTMLElement | null = null;
  private sectionMenuBtnEl: HTMLElement | null = null;
  private activePopover: TaskPopover | null = null;
  private calendarMainContainer: HTMLElement | null = null;
  private emptyStateContainer: HTMLElement | null = null;
  private currentView: ViewType = "month";
  private currentDate: Date = new Date();

  /** Responsive view switcher container (visibility controlled by CSS container queries) */
  private viewSwitcherContainer: HTMLElement | null = null;

  /** Header action buttons */
  private actionButtons: Record<string, HTMLElement> = {};

  /**
   * Regex pattern to match task checkbox prefix.
   * Matches: - [ ] or - [x] etc.
   * Captures: 1: full prefix with indentation, 2: checkbox char
   */
  private readonly TASK_PREFIX_REGEX = /^(\s*-\s*\[(.)\])\s*/;

  /**
   * Regex pattern to match markdown headings (level 1 and 2 only).
   * Matches: # Heading or ## Heading
   * Captures: 1: hash marks, 2: heading text
   */
  private readonly SECTION_REGEX = /^(#{1,2})\s+(.*)/;

  constructor(leaf: WorkspaceLeaf, plugin: CalendarPlugin) {
    super(leaf);
    this.plugin = plugin;
    this.currentView = plugin.settings.defaultView as ViewType;
  }

  getViewType(): string {
    return VIEW_TYPE_CALENDAR;
  }

  getDisplayText(): string {
    return this.file?.basename || "Calendar";
  }

  getIcon(): string {
    return "calendar";
  }

  /**
   * Returns the current file data for saving.
   * TextFileView requires this method.
   */
  getViewData(): string {
    return this.data;
  }

  /**
   * Called when file data needs to be loaded into the view.
   * TextFileView requires this method.
   */
  setViewData(data: string, clear: boolean): void {
    // Check if file still has calendar frontmatter
    if (!hasCalendarFrontmatter(data)) {
      // Switch back to markdown view
      this.plugin.calendarFileModes[
        (this.leaf as any).id || this.file?.path || ""
      ] = "markdown";
      this.plugin.setMarkdownView(this.leaf);
      return;
    }

    if (clear) {
      // Clear state when loading a new file
      this.activePopover?.close();
      this.activePopover = null;
      this.currentEvents.clear();
      this.sections.clear();
      Object.values(this.actionButtons).forEach((b) => b.remove());
      this.actionButtons = {};
    }

    // Parse and render
    this.parseMarkdown(data);
    this.updateViewState();
    this.updateSectionMenuButton();
    this.updateCalendarEvents();
    this.initHeaderButtons();
  }

  /**
   * Called when the view should clear its content.
   * TextFileView requires this method.
   */
  clear(): void {
    // Clear is called before loading a new file
    // We handle cleanup in setViewData with clear=true
  }

  async onOpen(): Promise<void> {
    const container = this.containerEl.children[1] as HTMLElement;
    container.empty();
    container.addClass("calendar-view-workspace");

    // Build toolbar (hidden initially until we know the state)
    this.buildToolbar(container);
    if (this.toolbarEl) this.toolbarEl.style.display = "none";

    // Create calendar container (hidden initially)
    this.calendarMainContainer = container.createDiv({
      cls: "calendar-main-container",
    });
    this.calendarMainContainer.style.display = "none";

    // Initialize calendar
    this.initializeCalendar(this.calendarMainContainer);

    // Build empty state UI (hidden initially)
    this.buildEmptyState(container);
  }

  /**
   * Adds "Open as markdown" option to the pane menu (right-click on tab or "more options" button).
   */
  onPaneMenu(menu: Menu, source: string): void {
    if (source !== "more-options") {
      super.onPaneMenu(menu, source);
      return;
    }

    menu.addItem((item) => {
      item
        .setTitle("Open as markdown")
        .setIcon("file-text")
        .setSection("pane")
        .onClick(() => {
          this.plugin.calendarFileModes[
            (this.leaf as any).id || this.file?.path || ""
          ] = "markdown";
          this.plugin.setMarkdownView(this.leaf);
        });
    });

    super.onPaneMenu(menu, source);
  }

  /**
   * Toggles between Empty State and Calendar View based on content.
   * Shows empty state when no headings exist and no tasks are present.
   */
  private updateViewState(): void {
    const hasOnlyDefaultSection =
      this.sections.size === 1 && this.sections.has(DEFAULT_SECTION_ID);
    const hasNoTasks = this.currentEvents.size === 0;
    const showEmptyState = hasOnlyDefaultSection && hasNoTasks;

    if (showEmptyState) {
      // Hide calendar, show empty state
      if (this.toolbarEl) this.toolbarEl.style.display = "none";
      if (this.calendarMainContainer)
        this.calendarMainContainer.style.display = "none";
      if (this.emptyStateContainer) {
        this.emptyStateContainer.style.display = "flex";
        // Auto-focus input for better UX
        const input = this.emptyStateContainer.querySelector("input");
        if (input) setTimeout(() => input.focus(), 50);
      }
    } else {
      // Show calendar, hide empty state
      if (this.toolbarEl) this.toolbarEl.style.display = "flex";
      if (this.calendarMainContainer) {
        this.calendarMainContainer.style.display = "flex";
        // Re-render calendar to ensure correct layout after visibility change
        if (this.calendar) this.calendar.render();
      }
      if (this.emptyStateContainer)
        this.emptyStateContainer.style.display = "none";
    }
  }

  /**
   * Builds the inline empty state UI for new calendars.
   * Displays a centered card with input field for calendar name.
   */
  private buildEmptyState(parent: HTMLElement): void {
    this.emptyStateContainer = parent.createDiv({
      cls: "calendar-empty-state",
    });
    this.emptyStateContainer.style.display = "none";

    const content = this.emptyStateContainer.createDiv({
      cls: "calendar-empty-content",
    });

    // Icon
    const iconEl = content.createDiv({ cls: "calendar-empty-icon" });
    setIcon(iconEl, "calendar-days");

    // Title & Description
    content.createEl("h2", {
      cls: "calendar-empty-title",
      text: "Create Your Calendar",
    });

    content.createEl("p", {
      cls: "calendar-empty-description",
      text: "Enter a name for your calendar to get started. You can create multiple calendars using headings.",
    });

    // Input Group
    const inputGroup = content.createDiv({ cls: "calendar-empty-input-group" });

    const input = inputGroup.createEl("input", {
      cls: "calendar-empty-input",
      type: "text",
      placeholder: "e.g., Work, Personal, Project...",
    });

    const button = inputGroup.createEl("button", {
      cls: "calendar-empty-button",
      text: "Create Calendar",
    });

    // Submit handler
    const handleSubmit = async () => {
      const name = input.value.trim();
      if (!name) {
        new Notice("Please enter a calendar name");
        input.focus();
        return;
      }
      await this.createInitialCalendar(name);
    };

    button.addEventListener("click", handleSubmit);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") handleSubmit();
    });
  }

  /**
   * Creates the initial calendar section with the given name.
   * Appends a new ## heading to the file.
   */
  private async createInitialCalendar(name: string): Promise<void> {
    if (!this.file) return;

    try {
      const prefix =
        this.data.trim().length > 0
          ? this.data.endsWith("\n")
            ? "\n"
            : "\n\n"
          : "";
      const newContent = `${this.data}${prefix}## ${name}\n`;

      await this.app.vault.modify(this.file, newContent);
      new Notice(`Calendar "${name}" created`);

      // Auto-select the new section after file watcher refresh
      setTimeout(() => {
        if (this.sections.has(name)) {
          this.activeSectionId = name;
          this.updateSectionMenuButton();
          this.updateCalendarEvents();
        }
      }, 600);
    } catch (error) {
      console.error("CalendarView: Failed to create initial calendar", error);
      new Notice("Failed to create calendar");
    }
  }

  /**
   * Initializes header action buttons (right side of the view header).
   */
  private initHeaderButtons = debounce(
    () => this._initHeaderButtons(),
    10,
    true,
  );

  private _initHeaderButtons(): void {
    // Add "Open as markdown" button
    if (!this.actionButtons["view-as-markdown"]) {
      this.actionButtons["view-as-markdown"] = this.addAction(
        "file-text",
        "Open as markdown",
        () => {
          this.plugin.calendarFileModes[
            (this.leaf as any).id || this.file?.path || ""
          ] = "markdown";
          this.plugin.setMarkdownView(this.leaf);
        },
      );
    }
  }

  /**
   * Builds the navigation toolbar for the calendar view.
   */
  private buildToolbar(parent: HTMLElement): void {
    this.toolbarEl = parent.createDiv({ cls: "calendar-toolbar nav-header" });

    // Section menu button & Add button
    const sectionGroup = this.toolbarEl.createDiv({
      cls: "calendar-section-group",
    });

    // Section menu button (shows current section name, click to open menu)
    this.sectionMenuBtnEl = sectionGroup.createEl("button", {
      cls: "calendar-toolbar-btn calendar-section-menu-btn",
      attr: { "aria-label": "Select calendar" },
    });
    this.updateSectionMenuButton();
    this.sectionMenuBtnEl.addEventListener("click", (evt) => {
      this.showSectionMenu(evt);
    });

    // Navigation buttons group
    const navGroup = this.toolbarEl.createDiv({ cls: "calendar-nav-group" });

    this.createButton(navGroup, "", "chevron-left", () => {
      this.calendar?.prev();
      this.navigateDate(-1);
      this.updateDateDisplay();
    });

    this.createButton(navGroup, "Today", "", () => {
      this.calendar?.today();
      this.currentDate = new Date();
      this.updateDateDisplay();
    });

    this.createButton(navGroup, "", "chevron-right", () => {
      this.calendar?.next();
      this.navigateDate(1);
      this.updateDateDisplay();
    });

    // Date display
    this.dateDisplayEl = this.toolbarEl.createDiv({
      cls: "calendar-date-display",
    });
    this.updateDateDisplay();

    // Responsive view switcher (tabs on wide screens, dropdown on narrow)
    this.initViewSwitcher(this.toolbarEl);
  }

  /**
   * Initializes the responsive view switcher.
   * Both tabs and dropdown variants are rendered simultaneously;
   * visibility is controlled by CSS container queries for optimal performance.
   */
  private initViewSwitcher(parent: HTMLElement): void {
    this.viewSwitcherContainer = parent.createDiv({
      cls: "calendar-view-switcher",
    });

    const views: { value: ViewType; label: string }[] = [
      { value: "month", label: "Month" },
      { value: "week", label: "Week" },
      { value: "day", label: "Day" },
    ];

    // Render both variants (CSS handles visibility switching)
    this.renderTabsSwitcher(views);
    this.renderDropdownSwitcher(views);

    // Sync initial state
    this.syncViewSwitcherState();
  }

  /**
   * Renders the dropdown variant of the view switcher.
   */
  private renderDropdownSwitcher(
    views: { value: ViewType; label: string }[],
  ): void {
    if (!this.viewSwitcherContainer) return;

    const select = this.viewSwitcherContainer.createEl("select", {
      cls: "calendar-view-select",
    });

    views.forEach((view) => {
      const opt = select.createEl("option", {
        value: view.value,
        text: view.label,
      });
      if (this.currentView === view.value) {
        opt.selected = true;
      }
    });

    select.addEventListener("change", (e) => {
      const value = (e.target as HTMLSelectElement).value as ViewType;
      this.setCurrentView(value);
    });
  }

  /**
   * Renders the tabs (segmented control) variant of the view switcher.
   */
  private renderTabsSwitcher(
    views: { value: ViewType; label: string }[],
  ): void {
    if (!this.viewSwitcherContainer) return;

    const tabGroup = this.viewSwitcherContainer.createDiv({
      cls: "calendar-view-tabs",
    });

    views.forEach((view) => {
      const isActive = this.currentView === view.value;
      const tab = tabGroup.createDiv({
        cls: `calendar-view-tab ${isActive ? "is-active" : ""}`,
        text: view.label,
      });

      tab.addEventListener("click", () => {
        if (this.currentView !== view.value) {
          this.setCurrentView(view.value);
        }
      });
    });
  }

  /**
   * Updates the current view and synchronizes UI state.
   */
  private setCurrentView(view: ViewType): void {
    this.currentView = view;
    this.calendar?.setView(view);
    this.updateDateDisplay();
    this.syncViewSwitcherState();
  }

  /**
   * Synchronizes both view switcher variants with the current view.
   * Updates tabs active state and dropdown selected value simultaneously.
   */
  private syncViewSwitcherState(): void {
    if (!this.viewSwitcherContainer) return;

    // Update tabs active state
    const tabs =
      this.viewSwitcherContainer.querySelectorAll(".calendar-view-tab");
    const viewOrder: ViewType[] = ["month", "week", "day"];

    tabs.forEach((tab, index) => {
      tab.removeClass("is-active");
      if (viewOrder[index] === this.currentView) {
        tab.addClass("is-active");
      }
    });

    // Update dropdown selected value
    const select = this.viewSwitcherContainer.querySelector(
      "select",
    ) as HTMLSelectElement | null;
    if (select) {
      select.value = this.currentView;
    }
  }

  /**
   * Navigate the current date by offset based on view type.
   */
  private navigateDate(direction: 1 | -1): void {
    const current = moment(this.currentDate);
    switch (this.currentView) {
      case "month":
        this.currentDate = current.add(direction, "month").toDate();
        break;
      case "week":
        this.currentDate = current.add(direction * 7, "day").toDate();
        break;
      case "day":
        this.currentDate = current.add(direction, "day").toDate();
        break;
    }
  }

  /**
   * Creates a toolbar button with optional icon.
   */
  private createButton(
    parent: HTMLElement,
    text: string,
    icon: string,
    onClick: () => void,
  ): HTMLButtonElement {
    const btn = parent.createEl("button", {
      cls: "calendar-toolbar-btn",
      attr: { "aria-label": text || icon },
    });

    if (icon) {
      const iconEl = btn.createSpan({ cls: "calendar-btn-icon" });
      setIcon(iconEl, icon);
    }

    if (text) {
      btn.createSpan({ cls: "calendar-btn-text", text });
    }

    btn.addEventListener("click", onClick);
    return btn;
  }

  /**
   * Updates the date display in the toolbar based on current calendar view.
   */
  private updateDateDisplay(): void {
    if (!this.dateDisplayEl) return;

    let format = "MMMM YYYY";
    if (this.currentView === "week") {
      format = "MMM D, YYYY";
    } else if (this.currentView === "day") {
      format = "dddd, MMM D, YYYY";
    }

    this.dateDisplayEl.textContent = moment(this.currentDate).format(format);
  }

  /**
   * Updates the section menu button text to show current section name.
   */
  private updateSectionMenuButton(): void {
    // Check if Default section has tasks
    const defaultSection = this.sections.get(DEFAULT_SECTION_ID);
    const defaultHasTasks = defaultSection && defaultSection.tasks.length > 0;

    // Validate active section still exists
    if (!this.sections.has(this.activeSectionId)) {
      this.activeSectionId = DEFAULT_SECTION_ID;
    }

    // If active is Default but Default has no tasks, switch to first non-Default section
    if (this.activeSectionId === DEFAULT_SECTION_ID && !defaultHasTasks) {
      const firstNonDefault = Array.from(this.sections.values())
        .filter((s) => s.id !== DEFAULT_SECTION_ID)
        .sort((a, b) => a.startLine - b.startLine)[0];
      if (firstNonDefault) {
        this.activeSectionId = firstNonDefault.id;
      }
    }

    if (!this.sectionMenuBtnEl) return;

    const activeSection = this.sections.get(this.activeSectionId);
    const displayName = activeSection?.name ?? "Default";

    this.sectionMenuBtnEl.empty();
    this.sectionMenuBtnEl.createSpan({
      text: displayName,
      cls: "calendar-section-name",
    });
    const chevron = this.sectionMenuBtnEl.createSpan({
      cls: "calendar-section-chevron",
    });
    setIcon(chevron, "chevron-down");
  }

  /**
   * Shows the section selection menu with hierarchical structure.
   */
  private showSectionMenu(evt: MouseEvent): void {
    const menu = new Menu();

    // Build hierarchical menu from sections
    this.buildSectionMenu(menu);

    // Add separator and "New Calendar" option
    menu.addSeparator();
    menu.addItem((item) => {
      item
        .setTitle("New Calendar...")
        .setIcon("plus")
        .onClick(() => {
          this.createNewSection();
        });
    });

    menu.showAtMouseEvent(evt);
  }

  /**
   * Builds hierarchical menu items from sections.
   * Level 1 headings (#) become parent items with submenus.
   * Level 2 headings (##) and Default become regular items or submenu items.
   * Default section is hidden when it's the only section.
   */
  private buildSectionMenu(menu: Menu): void {
    // Group sections by parent
    const level1Sections: CalendarSection[] = [];
    const childrenByParent: Map<string, CalendarSection[]> = new Map();

    // Check if Default section has any tasks
    const defaultSection = this.sections.get(DEFAULT_SECTION_ID);
    const defaultHasTasks = defaultSection && defaultSection.tasks.length > 0;

    this.sections.forEach((section) => {
      // Skip Default section unless it has tasks
      if (section.id === DEFAULT_SECTION_ID && !defaultHasTasks) {
        return;
      }

      if (section.level === 0 || section.level === 1) {
        // Default or # heading - top level
        level1Sections.push(section);
      } else if (section.parentId) {
        // ## heading - child of a # heading
        const children = childrenByParent.get(section.parentId) ?? [];
        children.push(section);
        childrenByParent.set(section.parentId, children);
      } else {
        // ## heading without parent - treat as top level
        level1Sections.push(section);
      }
    });

    // Sort by startLine to maintain document order
    level1Sections.sort((a, b) => a.startLine - b.startLine);

    level1Sections.forEach((section) => {
      const children = childrenByParent.get(section.id);
      const isActive = this.activeSectionId === section.id;

      if (children && children.length > 0) {
        // Has children - create submenu
        menu.addItem((item) => {
          item
            .setTitle(section.name)
            .setIcon(isActive ? "checkmark" : "")
            //@ts-ignore internal method
            .setSubmenu((submenu: Menu) => {
              // Add parent as first option in submenu
              submenu.addItem((subItem) => {
                subItem
                  .setTitle(`All in "${section.name}"`)
                  .setChecked(isActive)
                  .onClick(() => {
                    this.activeSectionId = section.id;
                    this.updateSectionMenuButton();
                    this.updateCalendarEvents();
                  });
              });

              submenu.addSeparator();

              // Add children
              children.sort((a, b) => a.startLine - b.startLine);
              children.forEach((child) => {
                const isChildActive = this.activeSectionId === child.id;
                submenu.addItem((subItem) => {
                  subItem
                    .setTitle(child.name)
                    .setChecked(isChildActive)
                    .onClick(() => {
                      this.activeSectionId = child.id;
                      this.updateSectionMenuButton();
                      this.updateCalendarEvents();
                    });
                });
              });
            });
        });
      } else {
        // No children - simple menu item
        menu.addItem((item) => {
          item
            .setTitle(section.name)
            .setChecked(isActive)
            .onClick(() => {
              this.activeSectionId = section.id;
              this.updateSectionMenuButton();
              this.updateCalendarEvents();
            });
        });
      }
    });
  }

  /**
   * Initializes the @taskgenius/calendar instance.
   * Uses MomentAdapter for seamless integration with Obsidian's moment.js
   */
  private initializeCalendar(container: HTMLElement): void {
    const settings = this.plugin.settings;

    // Use MomentAdapter for proper date/time handling with Obsidian's moment
    const dateAdapter = new MomentAdapter(moment);

    this.calendar = new Calendar(container, {
      dateAdapter,
      view: {
        type: settings.defaultView as ViewType,
      },
      onEventClick: (event: CalendarEvent, jsEvent?: MouseEvent) =>
        this.handleEventClick(event, jsEvent),
      onEventDrop: (event: CalendarEvent, newStart: Date, newEnd: Date) =>
        this.handleEventDrop(event, newStart, newEnd),
      onEventResize: (event: CalendarEvent, newStart: Date, newEnd: Date) =>
        this.handleEventResize(event, newStart, newEnd),
      // Month view: date range selection (no time)
      onDateRangeSelect: (start: Date, end: Date) =>
        this.handleDateSelect(start, end),
      // Week/Day view: time range selection (with time)
      onTimeRangeSelect: (start: Date, end: Date) =>
        this.handleDateSelect(start, end),
      // Custom event rendering for checkbox display
      onRenderEvent: (ctx) => this.handleRenderEvent(ctx),
    });
  }

  /**
   * Custom event render handler.
   * Renders checkbox when showEventCheckbox is enabled.
   */
  private handleRenderEvent(ctx: {
    event: CalendarEvent;
    el: HTMLElement;
    defaultRender: () => void;
  }): void {
    // Call default render for the rest of the content
    ctx.defaultRender();

    const { showEventCheckbox } = this.plugin.settings;
    const task = this.currentEvents.get(ctx.event.id);

    if (showEventCheckbox && task) {
      // Create checkbox element matching Obsidian's task list format
      const checkbox = createEl("input", {
        type: "checkbox",
        cls: "task-list-item-checkbox",
        dataset: {
          task: task.completed ? "x" : " ",
        },
      });
      if (task.completed) {
        checkbox.checked = true;
      }

      // Prevent checkbox click from bubbling to event click handler
      checkbox.addEventListener("click", (e) => {
        e.stopPropagation();
        this.handleCheckboxClick(task);
      });

      // Insert checkbox at the beginning of the event element
      ctx.el.insertBefore(checkbox, ctx.el.firstChild);

      // Add class for styling
      ctx.el.addClass("has-checkbox");
      if (task.completed) {
        ctx.el.addClass("is-completed");
      }
    }
  }

  /**
   * Handles date selection - opens task creation modal.
   * Supports multi-day selection and time tracking based on date format:
   * - Kanban: only tracks start time (no end time concept)
   * - Dataview: tracks both start and end time
   * - Tasks/Simple: no time support
   */
  private handleDateSelect(start: Date, end: Date): void {
    if (!this.file) return;

    const dateFormat = this.plugin.settings.recognizedDateFormat;
    const startMoment = moment(start);
    const endMoment = moment(end);

    const startDateStr = startMoment.format("YYYY-MM-DD");
    const endDateStr = endMoment.format("YYYY-MM-DD");
    const isMultiDay = startDateStr !== endDateStr;

    // Check if time was selected (in Week/Day view)
    const startHasTime = hasTimeComponent(start);
    const endHasTime = hasTimeComponent(end);

    // Determine time tracking based on format
    let startTimeStr: string | undefined;
    let endTimeStr: string | undefined;

    if (dateFormat === "kanban") {
      // Kanban: only track start time (no end time concept)
      if (startHasTime) {
        startTimeStr = startMoment.format("HH:mm");
      }
      // End time is ignored for Kanban
    } else if (dateFormat === "dataview" || dateFormat === "tasks") {
      // Dataview and Tasks: supports both start and end time
      if (startHasTime) {
        startTimeStr = startMoment.format("HH:mm");
      }
      if (endHasTime) {
        endTimeStr = endMoment.format("HH:mm");
      }
    }
    // Simple format: no time support (only date)

    new TaskCreationModal(this.app, startDateStr, async (taskName: string) => {
      await this.createTask(
        taskName,
        startDateStr,
        isMultiDay ? endDateStr : undefined,
        startTimeStr,
        endTimeStr,
      );
    }).open();
  }

  /**
   * Opens the modal to create a new calendar section (heading).
   * Inserts a new ## heading at the end of the file.
   */
  private createNewSection(): void {
    new CalendarCreationModal(this.app, async (name) => {
      if (!this.file || !name.trim()) return;

      try {
        // Append a new ## heading at the end of the file
        const prefix = this.data.endsWith("\n") ? "\n" : "\n\n";
        const newContent = `${this.data}${prefix}## ${name.trim()}\n`;

        await this.app.vault.modify(this.file, newContent);
        new Notice(`Calendar "${name}" created`);

        // Auto-select the new section after refresh (with delay for file watcher)
        const sectionName = name.trim();
        setTimeout(() => {
          if (this.sections.has(sectionName)) {
            this.activeSectionId = sectionName;
            this.updateSectionMenuButton();
            this.updateCalendarEvents();
          }
        }, 600);
      } catch (error) {
        console.error("CalendarView: Failed to create calendar section", error);
        new Notice("Failed to create calendar");
      }
    }).open();
  }

  /**
   * Builds the date part string for a new task based on the configured format.
   * @param format - The date format type (tasks, dataview, simple, kanban)
   * @param startDate - Start date in YYYY-MM-DD format
   * @param endDate - Optional end date in YYYY-MM-DD format
   * @param startTime - Optional start time in HH:mm format
   * @param endTime - Optional end time in HH:mm format
   * @returns Formatted date string for the task line
   */
  private buildDatePart(
    format: DateFormatType,
    startDate: string,
    endDate?: string,
    startTime?: string,
    endTime?: string,
  ): string {
    const isMultiDay = !!endDate;

    switch (format) {
      case "kanban": {
        // Kanban: @{YYYY-MM-DD} @@{HH:mm} - only start time, no end time
        const timePart = startTime ? ` @@{${startTime}}` : "";
        return `@{${startDate}}${timePart}`;
      }

      case "dataview": {
        // Dataview: [field:: YYYY-MM-DD] or [field:: YYYY-MM-DDTHH:mm]
        if (isMultiDay) {
          const startPart = startTime
            ? `[start:: ${startDate}T${startTime}]`
            : `[start:: ${startDate}]`;
          const endPart = endTime
            ? `[due:: ${endDate}T${endTime}]`
            : `[due:: ${endDate}]`;
          return `${startPart} ${endPart}`;
        }
        // Same day with time range: use start and due fields
        if (startTime && endTime) {
          return `[start:: ${startDate}T${startTime}] [due:: ${startDate}T${endTime}]`;
        }
        // Single point in time or no time
        return startTime
          ? `[due:: ${startDate}T${startTime}]`
          : `[due:: ${startDate}]`;
      }

      case "simple": {
        // Simple: @ YYYY-MM-DD (no time support)
        return `@ ${startDate}`;
      }

      case "tasks":
      default: {
        // Tasks plugin emoji format: 📅 YYYY-MM-DD HH:mm
        // If time range selected (same day or multi-day), use 🛫 start and 📅 end
        if (isMultiDay) {
          const startPart = startTime
            ? `🛫 ${startDate} ${startTime}`
            : `🛫 ${startDate}`;
          const endPart = endTime
            ? `📅 ${endDate} ${endTime}`
            : `📅 ${endDate}`;
          return `${startPart} ${endPart}`;
        }
        // Same day with time range: use 🛫 for start time, 📅 for end time
        if (startTime && endTime) {
          return `🛫 ${startDate} ${startTime} 📅 ${startDate} ${endTime}`;
        }
        // Single point in time or no time
        return startTime ? `📅 ${startDate} ${startTime}` : `📅 ${startDate}`;
      }
    }
  }

  /**
   * Creates a new task with the given name and date(s).
   * Inserts the task at the end of the currently active section.
   * @param taskName - The task description
   * @param startDate - The start/due date (used as 📅 for single-day, 🛫 for multi-day)
   * @param endDate - Optional end date for multi-day tasks (used as 📅)
   * @param startTime - Optional start time (HH:mm format, for Kanban/Dataview)
   * @param endTime - Optional end time (HH:mm format, for Dataview multi-day)
   */
  async createTask(
    taskName: string,
    startDate: string,
    endDate?: string,
    startTime?: string,
    endTime?: string,
  ): Promise<void> {
    if (!this.file || !taskName.trim()) return;

    try {
      const lines = this.data.split("\n");
      const dateFormat = this.plugin.settings.recognizedDateFormat;

      // Build date part based on format
      const datePart = this.buildDatePart(
        dateFormat,
        startDate,
        endDate,
        startTime,
        endTime,
      );
      const newTaskLine = `- [ ] ${taskName.trim()} ${datePart}`;

      // Determine insertion point based on active section
      const section = this.sections.get(this.activeSectionId);
      let insertIndex = lines.length;

      if (section) {
        // Insert at the end of the current section (before the next section starts)
        insertIndex = section.endLine;

        // If there are existing tasks in the section, insert after the last task
        if (section.tasks.length > 0) {
          const lastTask = section.tasks[section.tasks.length - 1];
          insertIndex = lastTask.lineIndex + 1;
        } else if (section.id !== DEFAULT_SECTION_ID) {
          // For non-default sections without tasks, insert right after the heading
          insertIndex = section.startLine;
        }
      }

      // Ensure we don't insert beyond the file
      insertIndex = Math.min(insertIndex, lines.length);

      // Insert the new task line
      lines.splice(insertIndex, 0, newTaskLine);

      await this.app.vault.modify(this.file, lines.join("\n"));

      new Notice("Task created!");
    } catch (error) {
      console.error("CalendarView: Failed to create task", error);
      new Notice("Failed to create task");
    }
  }

  /**
   * Refreshes the calendar with current file content.
   * Called externally when file changes are detected.
   */
  async refresh(): Promise<void> {
    if (!this.file || !this.calendar) return;

    try {
      const content = await this.app.vault.read(this.file);
      this.data = content;
      this.parseMarkdown(content);
      this.updateSectionMenuButton();
      this.updateCalendarEvents();
    } catch (error) {
      console.error("CalendarView: Failed to refresh calendar", error);
      new Notice("Failed to load calendar events");
    }
  }

  /**
   * Updates calendar events based on the currently active section.
   * Event rendering (including checkbox) is handled by onRenderEvent callback.
   */
  private updateCalendarEvents(): void {
    if (!this.calendar) return;

    const activeSection = this.sections.get(this.activeSectionId);
    const tasksToShow = activeSection?.tasks ?? [];

    const events: CalendarEvent[] = tasksToShow.map((task) => {
      // Determine start and end times
      let startStr: string;
      let endStr: string;

      // @taskgenius/calendar expects format: "YYYY-MM-DD HH:mm" (space, not T)
      const DATE_TIME_FORMAT = "YYYY-MM-DD HH:mm";

      if (task.isKanban && task.hasTime) {
        // Kanban with time: default 30 min duration
        startStr = task.date.format(DATE_TIME_FORMAT);
        endStr = moment(task.date).add(30, "minutes").format(DATE_TIME_FORMAT);
      } else {
        // Check for explicit start/due dates for multi-day or timed tasks
        const startField = task.allDates.find(
          (d) => d.type === DateFieldType.Start,
        );
        const dueField = task.allDates.find(
          (d) => d.type === DateFieldType.Due,
        );

        const DATE_ONLY_FORMAT = "YYYY-MM-DD";

        if (startField && dueField) {
          // Task with both start and due dates
          if (startField.hasTime || dueField.hasTime) {
            startStr = startField.date.format(DATE_TIME_FORMAT);
            // If due has no explicit time, set to end of day (23:59) to include
            // the full day in calendar rendering
            if (dueField.hasTime) {
              endStr = dueField.date.format(DATE_TIME_FORMAT);
            } else {
              endStr = dueField.date
                .clone()
                .hour(23)
                .minute(59)
                .format(DATE_TIME_FORMAT);
            }
          } else {
            // Date-only format
            startStr = startField.date.format(DATE_ONLY_FORMAT);
            endStr = dueField.date.format(DATE_ONLY_FORMAT);
          }
        } else if (startField) {
          // Only start date: use it for both start and end
          if (startField.hasTime) {
            startStr = startField.date.format(DATE_TIME_FORMAT);
            endStr = moment(startField.date)
              .add(30, "minutes")
              .format(DATE_TIME_FORMAT);
          } else {
            startStr = startField.date.format(DATE_ONLY_FORMAT);
            endStr = startField.date.format(DATE_ONLY_FORMAT);
          }
        } else if (dueField) {
          // Only due date: use it for both start and end
          if (dueField.hasTime) {
            startStr = dueField.date.format(DATE_TIME_FORMAT);
            endStr = moment(dueField.date)
              .add(30, "minutes")
              .format(DATE_TIME_FORMAT);
          } else {
            startStr = dueField.date.format(DATE_ONLY_FORMAT);
            endStr = dueField.date.format(DATE_ONLY_FORMAT);
          }
        } else if (task.hasTime) {
          // Single date with time (from primary date): use 30 min default duration
          startStr = task.date.format(DATE_TIME_FORMAT);
          endStr = moment(task.date)
            .add(30, "minutes")
            .format(DATE_TIME_FORMAT);
        } else {
          // Single-day task without time: start and end are the same
          startStr = task.date.format("YYYY-MM-DD");
          endStr = task.date.format("YYYY-MM-DD");
        }
      }

      return {
        id: task.id,
        title: task.title,
        start: startStr,
        end: endStr,
        color: task.completed
          ? "var(--text-muted)"
          : "var(--interactive-accent)",
        metadata: {
          lineIndex: task.lineIndex,
          completed: task.completed,
        },
        // Disable resize for Kanban format
        durationEditable: !task.isKanban,
      };
    });

    this.calendar.setEvents(events);
  }

  /**
   * Parses markdown content to extract sections and task lines with dates.
   * Tasks are grouped by their preceding heading (# or ##).
   * Tasks without a preceding heading belong to the 'Default' section.
   * Supports hierarchical structure: # headings are parents, ## headings are children.
   *
   * Supports multiple date formats:
   * - Tasks plugin emoji: 📅 🛫 ⏳ ➕ ✅ ❌
   * - Dataview inline: [due:: YYYY-MM-DD] (start:: YYYY-MM-DD)
   * - Simple: @ YYYY-MM-DD
   */
  private parseMarkdown(content: string): void {
    const lines = content.split("\n");
    this.currentEvents.clear();
    this.sections.clear();

    // Initialize default section for tasks before any heading
    let currentSectionId = DEFAULT_SECTION_ID;
    let currentLevel1Id: string | null = null; // Track current # heading for parent reference

    this.sections.set(currentSectionId, {
      id: currentSectionId,
      name: "Default",
      level: 0,
      parentId: null,
      startLine: 0,
      endLine: lines.length,
      tasks: [],
    });

    lines.forEach((line, index) => {
      // Check for heading (section boundary)
      const headingMatch = line.match(this.SECTION_REGEX);
      if (headingMatch) {
        // Close previous section's endLine
        const prevSection = this.sections.get(currentSectionId);
        if (prevSection) {
          prevSection.endLine = index;
        }

        // Determine heading level (1 for #, 2 for ##)
        const headingLevel = headingMatch[1].length;
        const headingText = headingMatch[2].trim();

        // Handle duplicate heading names by appending line number
        let uniqueId = headingText;
        if (this.sections.has(uniqueId)) {
          uniqueId = `${headingText}_${index}`;
        }

        // Determine parent based on heading level
        let parentId: string | null = null;
        if (headingLevel === 1) {
          // # heading - top level, becomes new parent
          currentLevel1Id = uniqueId;
          parentId = null;
        } else if (headingLevel === 2) {
          // ## heading - child of current # heading (if exists)
          parentId = currentLevel1Id;
        }

        this.sections.set(uniqueId, {
          id: uniqueId,
          name: headingText,
          level: headingLevel,
          parentId,
          startLine: index + 1,
          endLine: lines.length,
          tasks: [],
        });
        currentSectionId = uniqueId;
        return;
      }

      // Check for task line (must have checkbox prefix)
      const prefixMatch = line.match(this.TASK_PREFIX_REGEX);
      if (!prefixMatch) return;

      const checkMark = prefixMatch[2];
      const contentAfterCheckbox = line.slice(prefixMatch[0].length);

      // Extract dates using the new parser with configured priority and format filter
      const formatFilter = this.plugin.settings.recognizedDateFormat;
      const primaryDate = getPrimaryDate(
        contentAfterCheckbox,
        this.plugin.settings.datePriority,
        formatFilter,
      );
      if (!primaryDate) return; // Skip tasks without dates

      // Get all dates for metadata (with same format filter)
      const allDates = extractAllDates(contentAfterCheckbox, formatFilter);

      // Extract clean title (remove all date metadata)
      const cleanTitle =
        stripDates(contentAfterCheckbox).trim() || "Untitled Task";

      const task: TaskLine = {
        id: index.toString(),
        lineIndex: index,
        markdown: line,
        title: cleanTitle,
        date: primaryDate.date,
        dateType: primaryDate.type,
        allDates,
        hasTime: primaryDate.hasTime,
        isKanban: primaryDate.format === "kanban",
        completed: checkMark !== " ",
        sectionId: currentSectionId,
      };

      this.currentEvents.set(task.id, task);

      const section = this.sections.get(currentSectionId);
      if (section) {
        section.tasks.push(task);
      }
    });
  }

  /**
   * Handles event click - opens popover for editing task.
   * Checkbox clicks are handled separately by the checkbox element's own event listener.
   */
  private handleEventClick(event: CalendarEvent, jsEvent?: MouseEvent): void {
    if (!this.file) return;

    const task = this.currentEvents.get(event.id);
    if (!task) return;

    // Close existing popover if any
    if (this.activePopover) {
      this.activePopover.close();
      this.activePopover = null;
    }

    // Determine click position (fallback to center of screen if no event)
    const position = jsEvent
      ? { x: jsEvent.clientX, y: jsEvent.clientY }
      : { x: window.innerWidth / 2, y: window.innerHeight / 2 };

    // Open new popover
    this.activePopover = new TaskPopover(
      task,
      position,
      (id, updates) => this.updateTask(id, updates),
      (id) => this.deleteTask(id),
      (lineIndex) => this.jumpToLine(lineIndex),
    );
  }

  /**
   * Handles checkbox click - toggles completion and optionally moves task.
   * Separated from handleEventClick for clarity and maintainability.
   */
  private async handleCheckboxClick(task: TaskLine): Promise<void> {
    const { moveOnComplete } = this.plugin.settings;
    const isCompleting = !task.completed;

    // If completing and move-on-complete is enabled, move the task
    if (moveOnComplete && isCompleting) {
      await this.moveTaskToCompletedSection(task);
    } else {
      // Standard in-place toggle
      await this.toggleTaskCompletion(task);
    }
  }

  /**
   * Updates a task in the markdown file.
   * Preserves the original date format (emoji, dataview, or simple).
   */
  private async updateTask(
    id: string,
    updates: Partial<Pick<TaskLine, "title" | "date" | "completed">>,
  ): Promise<void> {
    if (!this.file) return;

    const task = this.currentEvents.get(id);
    if (!task) return;

    try {
      const lines = this.data.split("\n");

      // Validate line content hasn't changed
      if (lines[task.lineIndex] !== task.markdown) {
        new Notice("File has changed, please refresh");
        await this.refresh();
        return;
      }

      // Construct new line preserving indentation and date format
      const indentation = task.markdown.match(/^(\s*)/)?.[1] || "";
      const checkMark =
        updates.completed !== undefined
          ? updates.completed
            ? "x"
            : " "
          : task.completed
            ? "x"
            : " ";
      const title = updates.title ?? task.title;

      // Build date string preserving original format
      let dateMetadata = "";
      if (task.allDates.length > 0) {
        // Preserve all original dates, updating the primary one if needed
        const newPrimaryDate = updates.date ?? task.date;
        const primaryDateField = task.allDates.find(
          (d) => d.type === task.dateType,
        );

        for (const dateField of task.allDates) {
          if (dateField === primaryDateField) {
            // Update the primary date
            dateMetadata +=
              " " +
              formatDate(dateField.type, newPrimaryDate, dateField.format);
          } else {
            // Keep other dates as-is
            dateMetadata += " " + dateField.raw;
          }
        }
      } else {
        // Fallback: use emoji format for due date
        const dateStr = (updates.date ?? task.date).format("YYYY-MM-DD");
        dateMetadata = ` 📅 ${dateStr}`;
      }

      const newLine = `${indentation}- [${checkMark}] ${title}${dateMetadata}`;
      lines[task.lineIndex] = newLine;

      await this.app.vault.modify(this.file, lines.join("\n"));
      new Notice("Task updated");
    } catch (error) {
      console.error("CalendarView: Failed to update task", error);
      new Notice("Failed to update task");
    }
  }

  /**
   * Deletes a task from the markdown file.
   */
  private async deleteTask(id: string): Promise<void> {
    if (!this.file) return;

    const task = this.currentEvents.get(id);
    if (!task) return;

    try {
      const lines = this.data.split("\n");

      // Validate line content before deletion
      if (lines[task.lineIndex] === task.markdown) {
        lines.splice(task.lineIndex, 1);
        await this.app.vault.modify(this.file, lines.join("\n"));
        new Notice("Task deleted");
      } else {
        new Notice("Could not delete: content mismatch");
        await this.refresh();
      }
    } catch (error) {
      console.error("CalendarView: Failed to delete task", error);
      new Notice("Failed to delete task");
    }
  }

  /**
   * Detects calendar default drop times (midnight/noon) used for all-day drags.
   */
  private isDefaultDropTime(date: Date): boolean {
    const h = date.getHours();
    const m = date.getMinutes();
    return (h === 0 && m === 0) || (h === 12 && m === 0);
  }

  /**
   * Calendar emits end date as next-day midnight for all-day ranges.
   * Normalize to inclusive end date when the task does not track time.
   */
  private normalizeAllDayEnd(
    newStart: Date,
    newEnd: Date,
    task: TaskLine,
    startField?: ParsedDateField,
    dueField?: ParsedDateField,
  ): moment.Moment {
    const hasExplicitTime =
      task.hasTime || startField?.hasTime || dueField?.hasTime;
    const endIsDefault = this.isDefaultDropTime(newEnd);

    // When end time is a default (00:00 or 12:00), the calendar is signaling
    // an exclusive end date (i.e., "next day midnight" means the event ends
    // on the previous day). This applies regardless of whether the original
    // task had explicit time - the calendar always uses this convention for
    // all-day event boundaries.
    if (endIsDefault) {
      const startMoment = moment(newStart);
      const endMoment = moment(newEnd);

      if (endMoment.isAfter(startMoment, "day")) {
        // Calendar end for all-day is exclusive; shift back to inclusive
        endMoment.subtract(1, "day");
        // If the original task had explicit time, set end to 23:59 to ensure
        // the full day is included (otherwise it would be 00:00 which visually
        // appears as the previous day ending)
        if (hasExplicitTime) {
          endMoment.hour(23).minute(59);
        }
        return endMoment;
      }
      return endMoment;
    }

    return moment(newEnd);
  }

  /**
   * Reconstructs a task line with date fields in canonical order.
   * Order: Start → Scheduled → Due → Created → Done → Cancelled
   */
  private reconstructLine(
    baseLine: string,
    dateUpdates: Map<DateFieldType, string>,
  ): string {
    let result = baseLine.trimEnd();
    const order = [
      DateFieldType.Start,
      DateFieldType.Scheduled,
      DateFieldType.Due,
      DateFieldType.Created,
      DateFieldType.Done,
      DateFieldType.Cancelled,
    ];

    for (const type of order) {
      const formatted = dateUpdates.get(type);
      if (formatted) {
        result += " " + formatted;
      }
    }
    return result;
  }

  /**
   * Handles event drop - reschedules task to new date.
   * Supports all date formats: emoji, dataview, and simple.
   */
  private async handleEventDrop(
    event: CalendarEvent,
    newStart: Date,
    newEnd: Date,
  ): Promise<void> {
    if (!this.file) return;

    const task = this.currentEvents.get(event.id);
    if (!task) {
      new Notice("Error: Could not locate original task");
      return;
    }

    const newStartMoment = moment(newStart);
    const oldDateStr = task.date.format("YYYY-MM-DD");

    // Check if time component is present (not midnight)
    const startHasTime =
      newStart.getHours() !== 0 || newStart.getMinutes() !== 0;
    const endHasTime = newEnd.getHours() !== 0 || newEnd.getMinutes() !== 0;

    try {
      const lines = this.data.split("\n");

      // Verify line content hasn't changed
      let targetLineIndex = task.lineIndex;
      if (lines[targetLineIndex] !== task.markdown) {
        // Fallback: search for the line by content
        const found = lines.findIndex(
          (l) => l.includes(task.title) && l.includes(oldDateStr),
        );
        if (found === -1) {
          new Notice("Sync conflict: Task line not found. Please refresh.");
          await this.refresh();
          return;
        }
        targetLineIndex = found;
      }

      // Strip dates and prepare for reconstruction with canonical order
      const baseLine = stripDates(lines[targetLineIndex]);
      const dateUpdates = new Map<DateFieldType, string>();

      // Preserve all existing dates first
      for (const date of task.allDates) {
        dateUpdates.set(
          date.type,
          formatDate(date.type, date.date, date.format, date.hasTime),
        );
      }

      // Prepare end moment and date string
      const startField = task.allDates.find(
        (d) => d.type === DateFieldType.Start,
      );
      const dueField = task.allDates.find((d) => d.type === DateFieldType.Due);

      // For multi-day tasks, calculate new due based on duration offset rather than
      // relying on calendar's newEnd (which may be affected by rendering issues)
      let newEndMoment: moment.Moment;
      if (startField && dueField) {
        // Preserve original duration: shift due by the same delta as start
        const deltaMs = newStartMoment.diff(startField.date);
        newEndMoment = dueField.date.clone().add(deltaMs, "milliseconds");
      } else {
        // Single-date task: use calendar's newEnd with normalization
        newEndMoment = this.normalizeAllDayEnd(
          newStart,
          newEnd,
          task,
          startField,
          dueField,
        );
      }

      const newStartDateStr = newStartMoment.format("YYYY-MM-DD");

      // Check for multi-day task (has both start and due dates)
      if (startField && dueField) {
        // Multi-day task: update both start and due dates
        let finalStartMoment = newStartMoment.clone();
        let finalEndMoment = newEndMoment.clone();

        // Preserve original time if calendar used default time
        if (startField.hasTime && this.isDefaultDropTime(newStart)) {
          finalStartMoment
            .hour(startField.date.hour())
            .minute(startField.date.minute());
        }
        if (dueField.hasTime && this.isDefaultDropTime(newEnd)) {
          finalEndMoment
            .hour(dueField.date.hour())
            .minute(dueField.date.minute());
        }

        // Handle multi-day becoming single-day
        const wasMultiDay = !startField.date.isSame(dueField.date, "day");
        const isNowSingleDay = finalStartMoment.isSame(finalEndMoment, "day");
        if (wasMultiDay && isNowSingleDay) {
          if (finalEndMoment.isSameOrBefore(finalStartMoment)) {
            finalEndMoment.hour(23).minute(59);
          }
        }

        // Include time if original had time OR if user explicitly selected a non-default time
        const startIncludeTime =
          startField.hasTime ||
          (startHasTime && !this.isDefaultDropTime(newStart));
        const endIncludeTime =
          dueField.hasTime || (endHasTime && !this.isDefaultDropTime(newEnd));

        dateUpdates.set(
          DateFieldType.Start,
          formatDate(
            DateFieldType.Start,
            finalStartMoment,
            startField.format,
            startIncludeTime,
          ),
        );
        dateUpdates.set(
          DateFieldType.Due,
          formatDate(
            DateFieldType.Due,
            finalEndMoment,
            dueField.format,
            endIncludeTime,
          ),
        );
      } else {
        // Single-day task: update only the primary date field
        const primaryDateField = task.allDates.find(
          (d) => d.type === task.dateType,
        );

        if (primaryDateField) {
          const includeTime = startHasTime || primaryDateField.hasTime;
          dateUpdates.set(
            primaryDateField.type,
            formatDate(
              primaryDateField.type,
              newStartMoment,
              primaryDateField.format,
              includeTime,
            ),
          );
        } else {
          // Fallback: add due date if no parsed date fields
          const typeToAdd = task.dateType || DateFieldType.Due;
          dateUpdates.set(
            typeToAdd,
            formatDate(typeToAdd, newStartMoment, "tasks", startHasTime),
          );
        }
      }

      // Reconstruct line with dates in canonical order
      const updatedLine = this.reconstructLine(baseLine, dateUpdates);
      lines[targetLineIndex] = updatedLine;

      await this.app.vault.modify(this.file, lines.join("\n"));
      const timeStr = startHasTime ? ` ${newStartMoment.format("HH:mm")}` : "";
      new Notice(`Rescheduled to ${newStartDateStr}${timeStr}`);
    } catch (error) {
      console.error("CalendarView: Failed to update task date", error);
      new Notice("Failed to update task date");
      await this.refresh();
    }
  }

  /**
   * Handles event resize - ensures multi-day events have both start and due dates.
   * When resizing creates a date range (start != end), adds missing date fields:
   * - If missing start date -> add 🛫 with start date
   * - If missing due date -> add 📅 with end date
   */
  private async handleEventResize(
    event: CalendarEvent,
    newStart: Date,
    newEnd: Date,
  ): Promise<void> {
    console.log("handleEventResize called:", {
      eventId: event.id,
      eventTitle: event.title,
      newStart: newStart.toISOString(),
      newEnd: newEnd.toISOString(),
    });

    if (!this.file) return;

    const task = this.currentEvents.get(event.id);
    if (!task) {
      new Notice("Error: Could not locate original task");
      return;
    }

    // Kanban format does not support resize
    if (task.isKanban) {
      new Notice("Kanban format does not support resize");
      return;
    }

    try {
      const lines = this.data.split("\n");

      // Verify line content hasn't changed
      if (lines[task.lineIndex] !== task.markdown) {
        new Notice("File has changed, please refresh");
        await this.refresh();
        return;
      }

      // Strip dates and prepare for reconstruction with canonical order
      const baseLine = stripDates(lines[task.lineIndex]);
      const dateUpdates = new Map<DateFieldType, string>();

      // Preserve all existing dates first
      for (const date of task.allDates) {
        dateUpdates.set(
          date.type,
          formatDate(date.type, date.date, date.format, date.hasTime),
        );
      }

      const newStartMoment = moment(newStart);

      // Check if time component is present (not midnight)
      const startHasTime =
        newStart.getHours() !== 0 || newStart.getMinutes() !== 0;
      const endHasTime = newEnd.getHours() !== 0 || newEnd.getMinutes() !== 0;

      // Check existing date fields
      const startField = task.allDates.find(
        (d) => d.type === DateFieldType.Start,
      );
      const dueField = task.allDates.find((d) => d.type === DateFieldType.Due);
      const primaryField = task.allDates.find((d) => d.type === task.dateType);

      const newEndMoment = this.normalizeAllDayEnd(
        newStart,
        newEnd,
        task,
        startField,
        dueField,
      );
      const newStartDateStr = newStartMoment.format("YYYY-MM-DD");
      const newEndDateStr = newEndMoment.format("YYYY-MM-DD");

      // Check if this is a multi-day event
      const isMultiDay = newStartDateStr !== newEndDateStr;

      // Check if multi-day is becoming single-day
      const wasMultiDay =
        startField && dueField && !startField.date.isSame(dueField.date, "day");
      const isNowSingleDay = newStartDateStr === newEndDateStr;

      // Prepare final moments - may need to preserve original times
      let finalStartMoment = newStartMoment.clone();
      let finalEndMoment = newEndMoment.clone();

      // When resizing multi-day to single-day, preserve original times
      if (wasMultiDay && isNowSingleDay && startField && dueField) {
        if (startField.hasTime && this.isDefaultDropTime(newStart)) {
          finalStartMoment
            .hour(startField.date.hour())
            .minute(startField.date.minute());
        }
        if (dueField.hasTime && this.isDefaultDropTime(newEnd)) {
          finalEndMoment
            .hour(dueField.date.hour())
            .minute(dueField.date.minute());
        }
        if (finalEndMoment.isSameOrBefore(finalStartMoment)) {
          finalEndMoment.hour(23).minute(59);
        }
      }

      // Update Start date if present
      if (startField) {
        const includeTime =
          startField.hasTime ||
          (startHasTime && !this.isDefaultDropTime(newStart));
        dateUpdates.set(
          DateFieldType.Start,
          formatDate(
            DateFieldType.Start,
            finalStartMoment,
            startField.format,
            includeTime,
          ),
        );
      }

      // Update Due date if present
      if (dueField) {
        const includeTime =
          dueField.hasTime || (endHasTime && !this.isDefaultDropTime(newEnd));
        dateUpdates.set(
          DateFieldType.Due,
          formatDate(
            DateFieldType.Due,
            finalEndMoment,
            dueField.format,
            includeTime,
          ),
        );
      }

      // For multi-day events or time range events, add missing date fields
      if (isMultiDay || (startHasTime && endHasTime)) {
        if (!startField) {
          dateUpdates.set(
            DateFieldType.Start,
            formatDate(
              DateFieldType.Start,
              finalStartMoment,
              "tasks",
              startHasTime,
            ),
          );
        }
        if (!dueField) {
          dateUpdates.set(
            DateFieldType.Due,
            formatDate(DateFieldType.Due, finalEndMoment, "tasks", endHasTime),
          );
        }
      } else if (!startField && !dueField && primaryField) {
        // Single-day event with only a non-start/due date
        const includeTime = startHasTime || primaryField.hasTime;
        dateUpdates.set(
          primaryField.type,
          formatDate(
            primaryField.type,
            finalStartMoment,
            primaryField.format,
            includeTime,
          ),
        );
      }

      // Reconstruct line with dates in canonical order
      const updatedLine = this.reconstructLine(baseLine, dateUpdates);
      lines[task.lineIndex] = updatedLine;
      await this.app.vault.modify(this.file, lines.join("\n"));
      new Notice("Task date updated");
    } catch (error) {
      console.error("CalendarView: Failed to resize task", error);
      new Notice("Failed to update task date");
      await this.refresh();
    }
  }

  /**
   * Toggles task completion status in-place (without moving).
   * For tasks and dataview formats, automatically adds/removes completion date.
   */
  async toggleTaskCompletion(task: TaskLine): Promise<void> {
    if (!this.file) return;

    try {
      const lines = this.data.split("\n");
      const isCompleting = !task.completed;
      const newMark = isCompleting ? "x" : " ";
      const dateFormat = this.plugin.settings.recognizedDateFormat;

      let updatedLine = lines[task.lineIndex].replace(
        /^(\s*-\s*\[).\]/,
        `$1${newMark}]`,
      );

      // Handle completion date for tasks and dataview formats
      if (dateFormat === "tasks" || dateFormat === "dataview") {
        if (isCompleting) {
          // Add completion date
          const today = moment();
          const doneDate = formatDate(
            DateFieldType.Done,
            today,
            dateFormat === "tasks" ? "tasks" : "dataview-bracket",
          );
          updatedLine = updatedLine.trimEnd() + " " + doneDate;
        } else {
          // Remove existing completion date when uncompleting
          if (dateFormat === "tasks") {
            // Remove ✅ YYYY-MM-DD (with optional time)
            updatedLine = updatedLine.replace(
              /\s*✅\uFE0F?\s*\d{4}-\d{2}-\d{2}(?:\s+\d{1,2}:\d{2})?/g,
              "",
            );
          } else {
            // Remove [done:: ...] or (done:: ...) or [completed:: ...] etc.
            updatedLine = updatedLine.replace(
              /\s*[\[(](?:done|completed|completion|done date|completion date)::\s*\d{4}-\d{2}-\d{2}(?:T\d{1,2}:\d{2})?[\])]/gi,
              "",
            );
          }
        }
      }

      lines[task.lineIndex] = updatedLine;

      await this.app.vault.modify(this.file, lines.join("\n"));
      new Notice(task.completed ? "Task uncompleted" : "Task completed");
    } catch (error) {
      console.error("CalendarView: Failed to toggle task completion", error);
      new Notice("Failed to update task");
    }
  }

  /**
   * Moves a task to the configured completed section.
   * Marks the task as complete and relocates it under the target heading.
   * Creates the target heading if it doesn't exist.
   * For tasks and dataview formats, automatically adds completion date.
   */
  private async moveTaskToCompletedSection(task: TaskLine): Promise<void> {
    if (!this.file) return;

    const { completedSectionName } = this.plugin.settings;
    if (!completedSectionName) {
      // Fallback to simple toggle if no section name configured
      await this.toggleTaskCompletion(task);
      return;
    }

    try {
      const lines = this.data.split("\n");

      // Validate the task line hasn't changed
      if (lines[task.lineIndex] !== task.markdown) {
        new Notice("File has changed, please refresh");
        await this.refresh();
        return;
      }

      // Extract and mark the task as completed
      let taskLine = lines[task.lineIndex];
      taskLine = taskLine.replace(/^(\s*-\s*\[).\]/, "$1x]");

      // Add completion date for tasks and dataview formats
      const dateFormat = this.plugin.settings.recognizedDateFormat;
      if (dateFormat === "tasks" || dateFormat === "dataview") {
        const today = moment();
        const doneDate = formatDate(
          DateFieldType.Done,
          today,
          dateFormat === "tasks" ? "tasks" : "dataview-bracket",
        );
        taskLine = taskLine.trimEnd() + " " + doneDate;
      }

      // Remove the task from its current position
      lines.splice(task.lineIndex, 1);

      // Find the target section heading (## SectionName)
      const targetHeader = `## ${completedSectionName}`;
      let headerIndex = lines.findIndex((line) => line.trim() === targetHeader);

      if (headerIndex !== -1) {
        // Header exists - find the end of the section to insert task
        // Insert right after the header for most recent at top
        lines.splice(headerIndex + 1, 0, taskLine);
      } else {
        // Header doesn't exist - create it at the end of file
        // Ensure proper spacing before new section
        const lastLine = lines[lines.length - 1];
        if (lastLine && lastLine.trim() !== "") {
          lines.push("");
        }
        lines.push(targetHeader);
        lines.push(taskLine);
      }

      await this.app.vault.modify(this.file, lines.join("\n"));
      new Notice(`Moved to "${completedSectionName}"`);
    } catch (error) {
      console.error(
        "CalendarView: Failed to move task to completed section",
        error,
      );
      new Notice("Failed to move task");
    }
  }

  /**
   * Jumps to a specific line in the markdown editor.
   */
  private async jumpToLine(lineIndex: number): Promise<void> {
    if (!this.file) return;

    const leaf = this.app.workspace.getLeaf("tab");
    await leaf.openFile(this.file, {
      eState: { line: lineIndex },
    });
  }

  async onClose(): Promise<void> {
    // Close any open popover
    if (this.activePopover) {
      this.activePopover.close();
      this.activePopover = null;
    }

    if (this.calendar) {
      this.calendar.destroy();
      this.calendar = null;
    }

    this.currentEvents.clear();
    this.sections.clear();
    this.actionButtons = {};
  }
}

/**
 * Modal for creating a new task.
 */
class TaskCreationModal extends Modal {
  private taskName: string = "";
  private dateStr: string;
  private onSubmit: (taskName: string) => void;

  constructor(app: App, dateStr: string, onSubmit: (taskName: string) => void) {
    super(app);
    this.dateStr = dateStr;
    this.onSubmit = onSubmit;
  }

  onOpen(): void {
    const { contentEl } = this;

    contentEl.createEl("h2", { text: `Add Task for ${this.dateStr}` });

    new Setting(contentEl).setName("Task name").addText((text) => {
      text.setPlaceholder("Enter task name...");
      text.onChange((value) => {
        this.taskName = value;
      });
      // Focus and handle Enter key
      text.inputEl.focus();
      text.inputEl.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && this.taskName.trim()) {
          this.submit();
        }
      });
    });

    new Setting(contentEl)
      .addButton((btn) => {
        btn
          .setButtonText("Create")
          .setCta()
          .onClick(() => this.submit());
      })
      .addButton((btn) => {
        btn.setButtonText("Cancel").onClick(() => this.close());
      });
  }

  private submit(): void {
    if (this.taskName.trim()) {
      this.close();
      this.onSubmit(this.taskName);
    }
  }

  onClose(): void {
    const { contentEl } = this;
    contentEl.empty();
  }
}

/**
 * Modal for creating a new calendar section (heading).
 */
class CalendarCreationModal extends Modal {
  private name: string = "";
  private onSubmit: (name: string) => void;

  constructor(app: App, onSubmit: (name: string) => void) {
    super(app);
    this.onSubmit = onSubmit;
  }

  onOpen(): void {
    const { contentEl } = this;

    contentEl.createEl("h2", { text: "New Calendar" });

    new Setting(contentEl)
      .setName("Calendar Name")
      .setDesc("Enter a name for the new calendar section")
      .addText((text) => {
        text.setPlaceholder("e.g., Personal, Work...");
        text.onChange((value) => {
          this.name = value;
        });
        // Focus and handle Enter key
        text.inputEl.focus();
        text.inputEl.addEventListener("keydown", (e) => {
          if (e.key === "Enter") {
            this.submit();
          }
        });
      });

    new Setting(contentEl)
      .addButton((btn) => {
        btn
          .setButtonText("Create")
          .setCta()
          .onClick(() => this.submit());
      })
      .addButton((btn) => {
        btn.setButtonText("Cancel").onClick(() => this.close());
      });
  }

  private submit(): void {
    if (this.name.trim()) {
      this.onSubmit(this.name);
      this.close();
    } else {
      new Notice("Please enter a calendar name");
    }
  }

  onClose(): void {
    const { contentEl } = this;
    contentEl.empty();
  }
}
