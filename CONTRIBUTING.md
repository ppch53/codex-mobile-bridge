# Contributing to Codex Mobile Bridge

Thank you for your interest in contributing!

## Getting Started

1. Fork the repository
2. Clone your fork
3. Install dependencies: `npm install`
4. Create a feature branch: `git checkout -b feature/my-feature`
5. Make your changes
6. Run checks: `npx tsc --build && npx jest --no-cache && npx eslint . --ext .ts`
7. Commit and push
8. Open a Pull Request

## Development Guidelines

- **TypeScript**: All source code must be TypeScript with strict mode
- **Tests**: Add tests for new features. All existing tests must pass
- **Linting**: Code must pass ESLint with no errors (warnings are acceptable)
- **Commit Messages**: Use conventional commits (`feat:`, `fix:`, `docs:`, `refactor:`, `test:`)

## Project Structure

This is a monorepo using npm workspaces and TypeScript project references:

- `packages/` — Shared libraries
- `apps/` — Applications (bridge server, web frontend)

Each package has its own `tsconfig.json` that extends `tsconfig.base.json`.

## Pull Request Process

1. Ensure all tests pass and TypeScript compiles without errors
2. Update documentation if your change affects the public API
3. Keep PRs focused — one feature or fix per PR
4. PRs require at least one review before merging

## Reporting Issues

Use GitHub Issues to report bugs or request features. Include:
- Steps to reproduce (for bugs)
- Expected vs actual behavior
- Environment details (OS, Node version)
