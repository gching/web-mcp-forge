# Domain Docs

How engineering skills consume this repository’s domain documentation.

## Before exploring

Read:

- `CONTEXT.md` at the repository root.
- Relevant decisions under `docs/adr/`.

If either location does not exist, proceed silently. Domain-modeling skills create these files lazily when vocabulary or decisions are resolved.

## Layout

This is a single-context repository:

```text
/
├── CONTEXT.md
├── docs/
│   ├── adr/
│   └── agents/
├── examples/
├── packages/
└── server/
```

The client, server, and shared packages use the same Forge vocabulary and root architectural decisions.

## Use the glossary vocabulary

When naming a domain concept in issues, plans, tests, or code, use the term defined in `CONTEXT.md`. Avoid synonyms that the glossary explicitly rejects.

If a needed concept is absent, reconsider whether it belongs to the domain or note the gap for the domain-modeling skill.

## Flag ADR conflicts

If proposed work contradicts an existing ADR, surface the conflict explicitly rather than silently overriding the decision.
