> ⚠️ **Breaking:** `DEFAULT_THEME` now selects the visual theme (`aurora`, `midnight` or `graphite`) and the color scheme moved to the new `DEFAULT_COLOR_SCHEME`. An instance that still sets `DEFAULT_THEME` to `dark`, `light` or `system` refuses to start and names the value to set in `DEFAULT_COLOR_SCHEME` instead.

### ✨ Features

- **web**: Three visual themes, Aurora, Midnight and Graphite, each in a light and a dark color scheme.
- **server**: `DEFAULT_THEME` picks the theme of the web app and the new `DEFAULT_COLOR_SCHEME` sets the color scheme for new visitors.

### 🐛 Bug Fixes

- **web**: Text on a light `CUSTOM_COLOR` was unreadable because it was always white. It now turns white or black by itself, and the accent is darkened or lightened wherever it is used as text.
- **web**: The default color scheme of the server is no longer stored in the browser on the first visit, so a later change of the default reaches returning visitors.
- **web**: The color scheme menu shows the translated name of the system option instead of a fixed English "Auto".
- **web**: Dialogs, menus and tooltips animate again when they open and close, their animation classes had no effect.
- **web**: The password generator no longer makes passwords shorter than 8 characters when a smaller length is typed into its number field.
- **web**: The Markdown switch of text notes is translated.

### 🎨 Improvements

- **web**: The interface uses the Geist font, served by the instance itself without a request to a font service.

### 📝 Documentation

- **docs**: Documented `DEFAULT_THEME` and `DEFAULT_COLOR_SCHEME` in both environment variable references.

### 🧪 Tests

- **server**: Tests for the new theme and color scheme variables and for the hint a pre-v3 value gets.
- **web**: Tests that text on and next to the accent reaches a contrast of at least 4.5:1 for any color.
