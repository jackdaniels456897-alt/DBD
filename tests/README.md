# Visual Connection Regressions

Run the dependency-free unit tests with Node.js 22.6 or newer:

```sh
node --experimental-strip-types --test tests/visual-relations.test.ts
```

The tests import the actual parser, editing functions, and geometry helpers. They
cover both drag directions, both schema syntaxes, fan-out from one primary key,
duplicate detection, self-references, isolated edits, comments, and both table edges.

Browser checklist:

1. Use two tables with an `id int PK` and an unconnected `user_id int` column.
2. Drag from either side of `user_id` to `id`; verify the FK is added to `user_id`.
3. Remove the connection using its remove button, then drag from `id` to `user_id`.
4. Repeat with the tables swapped, stacked vertically, and after zooming or panning.
5. Connect the same `id` to another child table; verify both connections remain.
6. Repeat the reverse gesture on an existing connection; verify it is not duplicated.
7. Start a connection and press Escape, release on empty space, or leave the canvas;
   verify no connection is created or removed.
8. Confirm dragged table positions remain unchanged after any connection edit.

The production build does not execute these tests or substitute for browser checks.