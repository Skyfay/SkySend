### 🧪 Tests

- **crypto**: Tests now cover the length limits of an encrypted request brief, a brief that fills the largest size exactly and an ID with a prefix before the UUID. Mutation testing showed that these checks could break without a failing test.

### 🔧 CI/CD

- **infra**: Added mutation testing with Stryker. A pull request that changes the crypto package runs it and fails below a score of 85 %, and `pnpm test:mutation:all` or a manual run of the workflow tests the other packages.
