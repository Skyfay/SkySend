# General Guidelines
- Please write the code carefully, check it to make sure everything is secure and doesn't cause any security issues.

# Language & Commands

- Always use English
- Use hyphens instead of em dashes

# Code Style

- Write TypeScript, avoid `any` when possible
- Use modern Web APIs (e.g. Streams API instead of node-fetch)
- Prefer `const` over `let`
- Keep functions short

# Stack & Tools

- Package Manager: Always use `pnpm`
- Validation: Use `zod` for all data validation (API requests, config, frontend forms)
- i18n: Implement internationalization (e.g. `i18next`). Automatically detect browser language (e.g., `de-CH` -> `de`, `en-US` -> `en`) and always fallback to English.
