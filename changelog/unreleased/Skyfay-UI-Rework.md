> ⚠️ **Breaking:** `DEFAULT_THEME` now selects the visual theme (`graphite`, `aurora` or `midnight`) and the color scheme moved to the new `DEFAULT_COLOR_SCHEME`. An instance that still sets `DEFAULT_THEME` to `dark`, `light` or `system` refuses to start and names the value to set in `DEFAULT_COLOR_SCHEME` instead.

### ✨ Features

- **web**: Three visual themes, Graphite, Aurora and Midnight, each in a light and a dark color scheme. Graphite is the default.
- **server**: `DEFAULT_THEME` picks the theme of the web app and the new `DEFAULT_COLOR_SCHEME` sets the color scheme for new visitors.
- **web**: A new How it works page explains the encryption step by step and lets visitors encrypt a sample text in their own browser.

### 🐛 Bug Fixes

- **web**: Text on a light `CUSTOM_COLOR` was unreadable because it was always white. It now turns white or black by itself, and the accent is darkened or lightened wherever it is used as text.
- **web**: The default color scheme of the server is no longer stored in the browser on the first visit, so a later change of the default reaches returning visitors.
- **web**: The color scheme menu shows the translated name of the system option instead of a fixed English "Auto".
- **web**: Dialogs, menus and tooltips animate again when they open and close, their animation classes had no effect.
- **web**: The password generator no longer makes passwords shorter than 8 characters when a smaller length is typed into its number field.
- **web**: The Markdown switch of text notes is translated.
- **web**: Error messages under the upload and note forms are readable in the light color scheme, they were nearly white before.
- **web**: With a password forced by the server, the password field no longer disappears after starting a new upload or note, which made the next share fail.
- **web**: The QR code dialog and the button that shows the password of a protected download are translated.
- **web**: The share button of a generated SSH key is disabled while no part of the key is selected, it did nothing before.

### 🎨 Improvements

- **web**: The interface uses the Geist font, served by the instance itself without a request to a font service.
- **web**: A redesigned interface with a floating navigation bar, a new share form and new pages for receiving files and notes.
- **web**: The settings of a share are a row of pills that open their choices on a click. A sentence next to the share button says when the share will be deleted.
- **web**: Expired, used up and unknown links show one page with an explanation and a way back to sharing.
- **web**: My Links keeps the copy button at hand and moves opening, renaming, the QR code and deleting into a menu.
- **web**: Icon buttons show tooltips and have labels for screen readers, and the code blocks of a note open and close with the keyboard.

### 📝 Documentation

- **docs**: Documented `DEFAULT_THEME` and `DEFAULT_COLOR_SCHEME` in both environment variable references.
- **docs**: Described the three themes and how `CUSTOM_COLOR` applies to them, and added the steps to upgrade from v2.
- **docs**: First Steps matches the new interface and points to the How it works page.

### 🧪 Tests

- **server**: Tests for the new theme and color scheme variables and for the hint a pre-v3 value gets.
- **web**: Tests that text on and next to the accent reaches a contrast of at least 4.5:1 for any color.
- **web**: Tests for the color scheme choice, the accent injected for `CUSTOM_COLOR` and the file type badges.
