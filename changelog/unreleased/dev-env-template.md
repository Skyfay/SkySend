### 🔧 CI/CD

- **infra**: The dev environment comes from the tracked template `.env.dev.example`, and `.env.dev` is ignored by git, so local values and secrets stay out of the repository. The setup scripts create `.env.dev` for a new checkout or worktree.
