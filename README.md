# Calendar.MD

View your markdown tasks in a beautiful calendar interface. This plugin supports month, week, and day views with drag-and-drop rescheduling.

Sub-set of [Task Genius Plugin](https://github.com/taskgenius/taskgenius-plugin)

## Features

- **Multiple Views**: Switch between month, week, and day views
- **Nested calendar**: Organize tasks within nested calendars for better categorization (# for first level, ## for second level, etc.)
- **Drag-and-Drop**: Reschedule tasks by dragging them to a new date
- **Click to Create**: Click on any date to create a new task
- **Auto-Detection**: Files with `calendar-plugin` frontmatter automatically open in calendar view
- **Task Completion**: Toggle task completion directly from the calendar
- **Obsidian Integration**: Seamlessly integrates with Obsidian's theming system
- **Quick Navigation**: Jump to today or navigate between periods easily

## Installation

### From Obsidian Community Plugins [Not yet available]

1. Open Obsidian Settings
2. Go to Community Plugins
3. Search for "Calendar MD"
4. Click Install, then Enable

### Manual Installation

1. Download the latest release from the releases page
2. Extract the files to your vault's `.obsidian/plugins/calendar-md/` folder
3. Reload Obsidian
4. Enable the plugin in Settings → Community Plugins

## Usage

### Creating a New Calendar

There are several ways to create a new calendar:

1. **Ribbon Icon**: Click the calendar icon in the left ribbon
2. **Command Palette**: Use `Ctrl/Cmd + P` and search for "Create new calendar"
3. **Folder Context Menu**: Right-click a folder and select "New calendar"

New calendar files are created with the following frontmatter:

```yaml
---
calendar-plugin: basic
---
```

### Task Format

- Support `tasks`, `dataview`, `kanban` and basically with @YYYY-MM-DD

### Creating Tasks from Calendar

1. Click on any date cell in the calendar
2. A modal will appear asking for the task name
3. Press Enter or click "Create" to add the task

### Opening Files as Calendar

- **Automatic**: Files with `calendar-plugin` frontmatter open as calendar automatically
- **Manual**: Right-click a file and select "Open as Calendar"
- **Command**: Use the command "Open current file as Calendar"

### Commands

| Command | Description |
|---------|-------------|
| Create new calendar | Creates a new calendar file |
| Open current file as Calendar | Opens the active file in calendar view |
| Open current calendar as Markdown | Opens the calendar file in markdown view |
| Toggle between Calendar and Markdown view | Switches view mode |
| Switch to Month view | Changes to month view |
| Switch to Week view | Changes to week view |
| Switch to Day view | Changes to day view |
| Go to Today | Navigates to the current date |

### Settings

Access settings via Settings → Calendar MD:

- **Default View**: Choose the default calendar view (month/week/day)
- **Week Starts On**: Set whether the week starts on Sunday or Monday
- **Show Completed Tasks**: Toggle visibility of completed tasks

## Examples

### Project Planning Calendar

```markdown
---
calendar-plugin: basic
---

# Project Alpha

## Milestones

- [ ] Kickoff meeting 📅 2025-02-01
- [ ] Design review 📅 2025-02-15
- [ ] Development complete 📅 2025-03-01
- [ ] QA testing 📅 2025-03-15
- [ ] Launch 📅 2025-04-01

## Daily Tasks

- [ ] Morning standup @2025-02-03
- [ ] Sprint planning @2025-02-03
- [ ] Code review @2025-02-04
```

### Personal Task List

```markdown
---
calendar-plugin: basic
---

# February 2025

## Tasks

- [ ] Doctor appointment 📅 2025-02-10
- [ ] Pay rent 📅 2025-02-01
- [ ] Gym session @2025-02-05
- [x] Submit report 📅 2025-02-03
```

## Tips

1. **Click Date to Add Task**: Click on any date cell to quickly add a new task
2. **Drag to Reschedule**: Drag tasks between dates to reschedule them
3. **Click Event to Jump**: Click an event to jump to that line in the markdown file
4. **Toggle View Mode**: Use the command palette to switch between calendar and markdown views

## Development

### Building from Source

```bash
# Clone the repository
git clone https://github.com/taskgenius/calendar.md.git

# Install dependencies
pnpm install

# Build for development (with watch mode)
pnpm run dev

# Build for production
pnpm run build
```

## Credits

- Built with [@taskgenius/calendar](https://www.npmjs.com/package/@taskgenius/calendar)
- Forked from the original [Obsidian Kanban Plugin](https://github.com/mgmeyers/obsidian-kanban)
