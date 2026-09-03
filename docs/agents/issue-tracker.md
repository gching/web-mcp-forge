# Issue tracker: GitHub

Issues and specs for this repo live as GitHub issues in `gching/web-mcp-forge`. Use the `gh` CLI for all operations.

## Conventions

- **Create an issue**: `gh issue create --title "..." --body "..."`
- **Read an issue**: `gh issue view <number> --comments`
- **List issues**: `gh issue list --state open --json number,title,body,labels,comments`
- **Comment**: `gh issue comment <number> --body "..."`
- **Apply or remove labels**: `gh issue edit <number> --add-label "..."` or `--remove-label "..."`
- **Close**: `gh issue close <number> --comment "..."`

Infer the repository from `git remote -v`; `gh` does this automatically inside the clone.

## Pull requests as a triage surface

**PRs as a request surface: no.**

GitHub shares one number space across issues and pull requests. Resolve an ambiguous `#42` with `gh pr view 42`, then fall back to `gh issue view 42`.

## Skill operations

- When a skill says **publish to the issue tracker**, create a GitHub issue.
- When a skill says **fetch the relevant ticket**, run `gh issue view <number> --comments`.

## Wayfinding operations

- **Map**: one issue labelled `wayfinder:map`.
- **Child ticket**: a GitHub sub-issue linked to the map and labelled `wayfinder:<type>`.
- **Blocking**: use GitHub’s native issue dependencies. If unavailable, add `Blocked by: #<n>` to the child.
- **Frontier**: the first open, unassigned child without open blockers.
- **Claim**: `gh issue edit <number> --add-assignee @me`.
- **Resolve**: comment with the result, close the child, and add its context pointer to the map.
