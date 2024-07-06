# umbrel-app-liner-action

> A GitHub Action that checks your umbrelOS Apps for issues and provides fixes

## Linting apps on Pull Requests

When using Pull Requests, this action automatically detects the changed files.

```yml
name: CI

on:
  pull_request:
    types: [opened, synchronize, reopened]

jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      - name: Linting umbrelOS Apps
        uses: sharknoon/umbrel-app-linter-action@1
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
```

## Linting apps on every other event

You need to specify the base branch or commit hash as well as the head commit hash (no branch name!)
to compare those two git refs. This way the linter determines the changed files.

```yml
name: CI

on:
  push:
    branches:
      - main

jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      - name: Linting umbrelOS Apps
        uses: sharknoon/umbrel-app-linter-action@1
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
          base: "main"
          head-sha: ${{ github.sha }}
```
