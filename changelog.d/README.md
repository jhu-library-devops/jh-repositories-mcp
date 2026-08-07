# Changelog Fragments

Drop a fragment file here for each user-visible change. Fragments are consumed
by `bun run changelog:build` and merged into `CHANGELOG.md`.

## File naming

```
<name>.<type>.md
```

- **name** – a short slug or issue/PR number (e.g. `42`, `fix-cursor-leak`)
- **type** – one of the categories below

## Fragment types

| Type       | Section heading          |
|------------|--------------------------|
| `added`    | Added                    |
| `changed`  | Changed                  |
| `deprecated` | Deprecated             |
| `removed`  | Removed                  |
| `fixed`    | Fixed                    |
| `security` | Security                 |

## Content

Write a single Markdown bullet (no leading `-`, the tool adds it). Keep it to
one or two sentences written for end users.

### Example

File: `changelog.d/47.fixed.md`

```
Cursor pagination no longer skips items when Solr returns duplicate scores.
```

## Workflow

1. Create a fragment: `bun run changelog:new`
2. Commit the fragment alongside your code change.
3. At release time: `bun run changelog:build` to compile fragments into
   `CHANGELOG.md` and delete consumed fragments.
