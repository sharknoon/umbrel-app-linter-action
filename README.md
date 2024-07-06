# Umbrel App Linter

A GitHub Action that checks your umbrelOS Apps for issues and provides fixes.

## Linting apps on Pull Requests

When using Pull Requests, this action automatically detects the changed files and lints them.

The linting result will be published as annotations, a job summary and a Pull Request comment.

```yml
name: CI

on:
  pull_request:
    branches:
      - main

jobs:
  lint-apps:
    name: Lint apps
    runs-on: ubuntu-latest
    steps:
      - uses: sharknoon/umbrel-app-linter-action@v1
```

## Linting apps on every other event

You need to specify the base branch or commit hash as well as the head commit hash (no branch name!)
to compare those two git refs. This way the linter determines the changed files.

You can also supply a custom GitHub Token, if you need special permissions.

The linting result will be published as annotations and a job summary.

```yml
name: CI

on:
  push:
    branches:
      - main

jobs:
  lint-apps:
    name: Lint apps
    runs-on: ubuntu-latest
    steps:
      - uses: sharknoon/umbrel-app-linter-action@v1
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
          base: "main"
          head-sha: ${{ github.sha }}
```
