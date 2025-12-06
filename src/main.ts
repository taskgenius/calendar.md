import {
  Plugin,
  TFile,
  TFolder,
  MarkdownView,
  WorkspaceLeaf,
  ViewState,
  debounce,
} from "obsidian";
import { around } from "monkey-around";

import {
  CalendarView,
  VIEW_TYPE_CALENDAR,
  FRONTMATTER_KEY,
  BASIC_FRONTMATTER,
  hasCalendarFrontmatter,
} from "./CalendarView";
import {
  CalendarSettings,
  createDefaultSettings,
  CalendarSettingsTab,
} from "./Settings";

/**
 * Calendar MD Plugin for Obsidian
 *
 * Displays markdown tasks with dates in a calendar view.
 * Supports month, week, and day views with drag-and-drop rescheduling.
 */
export default class CalendarPlugin extends Plugin {
  settings: CalendarSettings = createDefaultSettings();

  /** Tracks view mode preference per file/leaf */
  calendarFileModes: Record<string, string> = {};

  /** Whether the plugin is fully loaded */
  private _loaded: boolean = false;

  async onload(): Promise<void> {
    await this.loadSettings();

    // Register the calendar view
    this.registerView(
      VIEW_TYPE_CALENDAR,
      (leaf) => new CalendarView(leaf, this),
    );

    // Register monkey patches for auto-detection
    this.registerMonkeyPatches();

    // Register settings tab
    this.addSettingTab(new CalendarSettingsTab(this.app, this));

    // Add ribbon icon
    this.addRibbonIcon("calendar", "Create new calendar", () => {
      this.newCalendar();
    });

    // Register commands
    this.registerCommands();

    // Register file menu
    this.registerFileMenu();

    // Register file change watcher
    this.registerFileWatcher();

    this._loaded = true;
  }

  /**
   * Registers plugin commands
   */
  private registerCommands(): void {
    // Create new calendar
    this.addCommand({
      id: "create-new-calendar",
      name: "Create new calendar",
      callback: () => this.newCalendar(),
    });

    // Open current file as calendar
    this.addCommand({
      id: "open-as-calendar",
      name: "Open current file as Calendar",
      checkCallback: (checking: boolean) => {
        const file = this.app.workspace.getActiveFile();
        if (checking) {
          return !!file;
        }
        if (file) {
          const leaf = this.app.workspace.getLeaf(false);
          this.calendarFileModes[(leaf as any).id || file.path] =
            VIEW_TYPE_CALENDAR;
          this.setCalendarView(leaf);
        }
      },
    });

    // Open current calendar as markdown
    this.addCommand({
      id: "open-as-markdown",
      name: "Open current calendar as Markdown",
      checkCallback: (checking: boolean) => {
        const view = this.app.workspace.getActiveViewOfType(CalendarView);
        if (checking) {
          return !!view;
        }
        if (view) {
          this.calendarFileModes[
            (view.leaf as any).id || view.file?.path || ""
          ] = "markdown";
          this.setMarkdownView(view.leaf);
        }
      },
    });

    // Toggle between markdown and calendar view
    this.addCommand({
      id: "toggle-calendar-view",
      name: "Toggle between Calendar and Markdown view",
      checkCallback: (checking: boolean) => {
        const activeFile = this.app.workspace.getActiveFile();
        if (!activeFile) return false;

        const calendarView =
          this.app.workspace.getActiveViewOfType(CalendarView);
        const markdownView =
          this.app.workspace.getActiveViewOfType(MarkdownView);

        if (checking) {
          return !!(calendarView || markdownView);
        }

        if (calendarView) {
          this.calendarFileModes[
            (calendarView.leaf as any).id || activeFile.path
          ] = "markdown";
          this.setMarkdownView(calendarView.leaf);
        } else if (markdownView) {
          this.calendarFileModes[
            (markdownView.leaf as any).id || activeFile.path
          ] = VIEW_TYPE_CALENDAR;
          this.setCalendarView(markdownView.leaf);
        }
      },
    });

    // Switch to month view
    this.addCommand({
      id: "calendar-month-view",
      name: "Switch to Month view",
      checkCallback: (checking: boolean) => {
        const view = this.app.workspace.getActiveViewOfType(CalendarView);
        if (checking) {
          return !!view;
        }
        if (view && view.calendar) {
          view.calendar.setView("month");
        }
      },
    });

    // Switch to week view
    this.addCommand({
      id: "calendar-week-view",
      name: "Switch to Week view",
      checkCallback: (checking: boolean) => {
        const view = this.app.workspace.getActiveViewOfType(CalendarView);
        if (checking) {
          return !!view;
        }
        if (view && view.calendar) {
          view.calendar.setView("week");
        }
      },
    });

    // Switch to day view
    this.addCommand({
      id: "calendar-day-view",
      name: "Switch to Day view",
      checkCallback: (checking: boolean) => {
        const view = this.app.workspace.getActiveViewOfType(CalendarView);
        if (checking) {
          return !!view;
        }
        if (view && view.calendar) {
          view.calendar.setView("day");
        }
      },
    });

    // Navigate to today
    this.addCommand({
      id: "calendar-today",
      name: "Go to Today",
      checkCallback: (checking: boolean) => {
        const view = this.app.workspace.getActiveViewOfType(CalendarView);
        if (checking) {
          return !!view;
        }
        if (view && view.calendar) {
          view.calendar.today();
        }
      },
    });
  }

  /**
   * Registers file menu items
   */
  private registerFileMenu(): void {
    this.registerEvent(
      this.app.workspace.on("file-menu", (menu, file, source, leaf) => {
        if (file instanceof TFolder) {
          // Add "New calendar" option for folders
          menu.addItem((item) => {
            item
              .setTitle("New calendar")
              .setIcon("calendar")
              .setSection("action-primary")
              .onClick(() => this.newCalendar(file));
          });
          return;
        }

        if (!(file instanceof TFile)) return;

        const isCalendarView = leaf?.view instanceof CalendarView;
        const cache = this.app.metadataCache.getFileCache(file);
        const hasCalendarFrontmatter =
          cache?.frontmatter && cache.frontmatter[FRONTMATTER_KEY];

        if (isCalendarView) {
          // Show "Open as Markdown" option
          menu.addItem((item) => {
            item
              .setTitle("Open as Markdown")
              .setIcon("document")
              .setSection("pane")
              .onClick(() => {
                if (leaf) {
                  this.calendarFileModes[(leaf as any).id || file.path] =
                    "markdown";
                  this.setMarkdownView(leaf);
                }
              });
          });
        } else if (hasCalendarFrontmatter) {
          // Show "Open as Calendar" option
          menu.addItem((item) => {
            item
              .setTitle("Open as Calendar")
              .setIcon("calendar")
              .setSection("pane")
              .onClick(() => {
                if (leaf) {
                  this.calendarFileModes[(leaf as any).id || file.path] =
                    VIEW_TYPE_CALENDAR;
                  this.setCalendarView(leaf);
                }
              });
          });
        }
      }),
    );
  }

  /**
   * Registers file change watcher for auto-refresh
   */
  private registerFileWatcher(): void {
    const notifyFileChange = debounce(
      (file: TFile) => {
        const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_CALENDAR);
        leaves.forEach((leaf) => {
          const view = leaf.view as CalendarView;
          if (view.file?.path === file.path) {
            view.refresh();
          }
        });
      },
      500,
      true,
    );

    this.registerEvent(
      this.app.vault.on("modify", (file) => {
        if (file instanceof TFile) {
          notifyFileChange(file);
        }
      }),
    );
  }

  /**
   * Registers monkey patches for auto-detecting calendar files
   */
  private registerMonkeyPatches(): void {
    const self = this;

    // Monkey patch WorkspaceLeaf to intercept setViewState
    this.register(
      around(WorkspaceLeaf.prototype, {
        // Track when leaves are detached to clean up state
        detach(next) {
          return function (this: WorkspaceLeaf) {
            const state = this.view?.getState();
            if (
              state?.file &&
              self.calendarFileModes[(this as any).id || state.file]
            ) {
              delete self.calendarFileModes[(this as any).id || state.file];
            }
            return next.apply(this);
          };
        },

        // Intercept view state changes to auto-switch to calendar view
        setViewState(next) {
          return function (
            this: WorkspaceLeaf,
            state: ViewState,
            eState?: any,
          ) {
            // Check if we should intervene
            if (
              self._loaded &&
              state.type === "markdown" &&
              state.state?.file
            ) {
              const filePath = state.state.file as string;
              const fileId = (this as any).id || filePath;

              // If explicitly set to markdown by user action, skip
              if (self.calendarFileModes[fileId] === "markdown") {
                return next.call(this, state, eState);
              }

              // Check frontmatter
              const cache = self.app.metadataCache.getCache(filePath);
              if (cache?.frontmatter && cache.frontmatter[FRONTMATTER_KEY]) {
                // Switch to calendar view
                const newState: ViewState = {
                  ...state,
                  type: VIEW_TYPE_CALENDAR,
                };

                // Remember this preference
                self.calendarFileModes[fileId] = VIEW_TYPE_CALENDAR;

                return next.call(this, newState, eState);
              }
            }

            return next.call(this, state, eState);
          };
        },
      }),
    );
  }

  /**
   * Creates a new calendar file
   */
  async newCalendar(folder?: TFolder): Promise<void> {
    const targetFolder = folder
      ? folder
      : this.app.fileManager.getNewFileParent(
          this.app.workspace.getActiveFile()?.path || "",
        );

    try {
      // Generate unique filename
      let filename = "Untitled Calendar";
      let path = `${targetFolder.path}/${filename}.md`;
      let counter = 1;

      while (this.app.vault.getAbstractFileByPath(path)) {
        filename = `Untitled Calendar ${counter++}`;
        path = `${targetFolder.path}/${filename}.md`;
      }

      // Create the file with frontmatter
      const file = await this.app.vault.create(path, BASIC_FRONTMATTER);

      // Open directly in calendar view using setViewState
      // This bypasses the metadata cache race condition that occurs with openFile
      const leaf = this.app.workspace.getLeaf(false);
      this.calendarFileModes[(leaf as any).id || file.path] =
        VIEW_TYPE_CALENDAR;

      await leaf.setViewState({
        type: VIEW_TYPE_CALENDAR,
        state: { file: file.path },
      });
    } catch (error) {
      console.error("CalendarPlugin: Error creating calendar:", error);
    }
  }

  /**
   * Sets the leaf to calendar view
   */
  async setCalendarView(leaf: WorkspaceLeaf): Promise<void> {
    await leaf.setViewState({
      type: VIEW_TYPE_CALENDAR,
      state: leaf.view.getState(),
    });
  }

  /**
   * Sets the leaf to markdown view
   */
  async setMarkdownView(leaf: WorkspaceLeaf): Promise<void> {
    await leaf.setViewState({
      type: "markdown",
      state: leaf.view.getState(),
    });
  }

  async loadSettings(): Promise<void> {
    const savedData = await this.loadData();
    const defaults = createDefaultSettings();

    // Deep merge saved data with defaults to ensure all nested properties exist
    this.settings = {
      ...defaults,
      ...savedData,
      // Deep merge colors to preserve nested structure
      colors: {
        ...defaults.colors,
        ...(savedData?.colors || {}),
        // Ensure defaultEventColor has both light and dark
        defaultEventColor: {
          ...defaults.colors.defaultEventColor,
          ...(savedData?.colors?.defaultEventColor || {}),
        },
        // Deep copy arrays to prevent mutation
        colorRules: savedData?.colors?.colorRules
          ? savedData.colors.colorRules.map((rule: any) => ({
              ...rule,
              color: { ...rule.color },
            }))
          : [],
        // Deep copy calendarSources
        calendarSources: savedData?.colors?.calendarSources
          ? Object.fromEntries(
              Object.entries(savedData.colors.calendarSources).map(
                ([k, v]: [string, any]) => [
                  k,
                  { ...v, color: v.color ? { ...v.color } : undefined },
                ],
              ),
            )
          : {},
      },
      // Ensure datePriority is a fresh array
      datePriority: savedData?.datePriority
        ? [...savedData.datePriority]
        : [...defaults.datePriority],
    };
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  onunload(): void {
    this._loaded = false;
    this.calendarFileModes = {};
  }
}
