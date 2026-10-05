### 🔧 CI/CD

- **infra**: Lint, type check, unit tests and the docs build now also run on pull requests into `dev`, and every pull request now builds the website as well.
- **infra**: A pull request into `main` can build the Docker image for both platforms and start it once, after a maintainer approves the build.
