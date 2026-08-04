# Complex Markdown Fixture (TASK-M2-07)

A fixture exercising the GFM surface rendered by `markdown.ts`: headings,
emphasis, lists, task lists, tables, blockquotes, links, inline code,
fenced code blocks and strikethrough.

## Features

- **Bold**, *italic*, ~~strikethrough~~ and `inline code`.
- [External link](https://example.com/docs) with a relative [anchor](#features).
- Ordered list:
  1. first item
  2. second item with a nested list
     - nested a
     - nested b

### Task list

- [x] shipped task
- [ ] pending task

### Table

| Name  | Role     | Status |
| ----- | -------- | ------ |
| Alice | builder  | done   |
| Bob   | reviewer | active |

> A blockquote with **emphasis** inside.

---

```ts
// TypeScript fence
const handler = (n: number): number => n * 2;
export default handler;
```

```bash
echo "shell fence"
```

```
no language fence
```
