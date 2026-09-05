import assert from 'node:assert/strict';
import test from 'node:test';
import { parseSchema } from '../src/lib/parser.ts';
import {
  createVisualConnection,
  removeVisualConnection,
  type ColumnEndpoint,
} from '../src/lib/visualRelations.ts';
import {
  buildConnector,
  computeAnchors,
  hitColumn,
  placeNewTables,
  rowCenterY,
  tableRect,
} from '../src/lib/geometry.ts';

const inline = `Users
-----
id int PK
email varchar UNIQUE

Posts
-----
id int PK
user_id int NULL
reviewer_email varchar NULL

Comments
-----
id int PK
user_id int
`;

const bracketed = `users {
  id int [pk, increment]
  email varchar [unique]
}

posts {
  id int [pk, increment]
  user_id int [null, index, default:0, note:"owner, FK >- users.id"] // keep this comment
}

comments {
  id int [pk, increment]
  user_id int
}`;

const endpoint = (table: string, column: string): ColumnEndpoint => ({ table, column });
const parent = endpoint('Users', 'id');
const child = endpoint('Posts', 'user_id');

function ids(text: string) {
  return parseSchema(text).relationships.map((rel) => rel.id).sort();
}

function column(text: string, table: string, name: string) {
  const found = parseSchema(text).tables.find((t) => t.name === table)?.columns.find((c) => c.name === name);
  assert.ok(found, `Missing ${table}.${name}`);
  return found;
}

test('PK-to-FK and FK-to-PK produce exactly the same inline schema', () => {
  const forward = createVisualConnection(inline, child, parent);
  const reverse = createVisualConnection(inline, parent, child);
  assert.equal(forward.status, 'created');
  assert.equal(reverse.status, 'created');
  assert.equal(forward.text, reverse.text);
  assert.deepEqual(ids(reverse.text), ['Posts.user_id->Users.id']);
  assert.equal(column(reverse.text, 'Users', 'id').pk, true);
  assert.equal(column(reverse.text, 'Users', 'id').fk, false);
  assert.equal(column(reverse.text, 'Posts', 'user_id').nullable, true);
  assert.equal(parseSchema(reverse.text).diagnostics.length, 0);
});

test('both gestures preserve bracket attributes, indentation, and comments', () => {
  const pk = endpoint('users', 'id');
  const fk = endpoint('posts', 'user_id');
  const forward = createVisualConnection(bracketed, fk, pk);
  const reverse = createVisualConnection(bracketed, pk, fk);
  assert.equal(forward.status, 'created');
  assert.equal(forward.text, reverse.text);
  assert.match(reverse.text, /  user_id int \[null, index, default:0, note:"owner, FK >- users.id", ref: >- users.id\] \/\/ keep this comment/);
  const updated = column(reverse.text, 'posts', 'user_id');
  assert.equal(updated.note, 'owner, FK >- users.id');
  assert.equal(updated.defaultValue, '0');
  assert.equal(updated.index, true);
  assert.equal(updated.nullable, true);
  assert.equal(column(reverse.text, 'users', 'id').increment, true);
  assert.equal(parseSchema(reverse.text).diagnostics.length, 0);
});

test('starting from one primary key can connect multiple child columns', () => {
  const first = createVisualConnection(inline, parent, child);
  const second = createVisualConnection(first.text, parent, endpoint('Comments', 'user_id'));
  assert.equal(second.status, 'created');
  assert.deepEqual(ids(second.text), ['Comments.user_id->Users.id', 'Posts.user_id->Users.id']);
  assert.equal(column(second.text, 'Users', 'id').ref, undefined);
});

test('repeating a connection in the opposite direction does not create a duplicate', () => {
  const first = createVisualConnection(inline, child, parent);
  const second = createVisualConnection(first.text, parent, child);
  assert.equal(second.status, 'unchanged');
  assert.equal(second.text, first.text);
  assert.equal(ids(second.text).length, 1);
});

test('UNIQUE can be the reference key in either drag direction', () => {
  const key = endpoint('Users', 'email');
  const foreign = endpoint('Posts', 'reviewer_email');
  const a = createVisualConnection(inline, key, foreign);
  const b = createVisualConnection(inline, foreign, key);
  assert.equal(a.text, b.text);
  assert.deepEqual(ids(a.text), ['Posts.reviewer_email->Users.email']);
  assert.equal(column(a.text, 'Users', 'email').fk, false);
});

test('a column in a composite PK still receives the FK from a single-column PK', () => {
  const schema = `${inline}\nMembers\n-----\nuser_id int PK\nteam_id int PK\n`;
  const member = endpoint('Members', 'user_id');
  const a = createVisualConnection(schema, parent, member);
  const b = createVisualConnection(schema, member, parent);
  assert.equal(a.text, b.text);
  assert.deepEqual(ids(a.text), ['Members.user_id->Users.id']);
  const relation = parseSchema(a.text).relationships[0];
  assert.equal(relation.fromCard, 'many');
  assert.equal(column(a.text, 'Members', 'user_id').pk, true);
});

test('an existing PK/FK pair keeps its one-to-one cardinality when dragged backwards', () => {
  const schema = `${inline}\nProfiles\n-----\nuser_id int PK FK - Users.id\n`;
  const result = createVisualConnection(schema, parent, endpoint('Profiles', 'user_id'));
  assert.equal(result.status, 'unchanged');
  assert.equal(result.text, schema);
  assert.equal(parseSchema(result.text).relationships[0].fromCard, 'one');
});

test('self-references between different columns work in either direction', () => {
  const schema = 'Nodes\n-----\nid int PK\nparent_id int NULL\n';
  const pk = endpoint('Nodes', 'id');
  const fk = endpoint('Nodes', 'parent_id');
  const a = createVisualConnection(schema, pk, fk);
  const b = createVisualConnection(schema, fk, pk);
  assert.equal(a.text, b.text);
  assert.deepEqual(ids(a.text), ['Nodes.parent_id->Nodes.id']);
});

test('changing an FK edits only its source line, including in brace syntax', () => {
  const first = createVisualConnection(bracketed, endpoint('users', 'id'), endpoint('posts', 'user_id'));
  const second = createVisualConnection(first.text, endpoint('comments', 'id'), endpoint('posts', 'user_id'));
  assert.equal(second.status, 'updated');
  assert.deepEqual(ids(second.text), ['posts.user_id->comments.id']);
  const line = column(first.text, 'posts', 'user_id').line;
  const before = first.text.split('\n');
  const after = second.text.split('\n');
  assert.equal(before.length, after.length);
  before.forEach((value, index) => {
    if (index !== line - 1) assert.equal(after[index], value);
  });
  assert.equal(column(second.text, 'posts', 'user_id').note, 'owner, FK >- users.id');
});

test('removal preserves all other references to the same key and the column attributes', () => {
  const pk = endpoint('users', 'id');
  const first = createVisualConnection(bracketed, pk, endpoint('posts', 'user_id'));
  const second = createVisualConnection(first.text, pk, endpoint('comments', 'user_id'));
  const removed = removeVisualConnection(second.text, 'posts.user_id->users.id');
  assert.equal(removed.status, 'removed');
  assert.deepEqual(ids(removed.text), ['comments.user_id->users.id']);
  const kept = column(removed.text, 'posts', 'user_id');
  assert.equal(kept.fk, false);
  assert.equal(kept.note, 'owner, FK >- users.id');
  assert.equal(kept.index, true);
  assert.equal(kept.defaultValue, '0');
  assert.ok(removed.text.includes('// keep this comment'));
});

test('removal supports the inline reference format without removing columns', () => {
  const created = createVisualConnection(inline, parent, child);
  const removed = removeVisualConnection(created.text, 'Posts.user_id->Users.id');
  assert.equal(removed.status, 'removed');
  assert.equal(removed.text, inline);
});

test('a same-column drop or missing endpoint never modifies the schema', () => {
  assert.equal(createVisualConnection(inline, parent, parent).text, inline);
  const missing = createVisualConnection(inline, parent, endpoint('Posts', 'absent'));
  assert.equal(missing.status, 'error');
  assert.equal(missing.text, inline);
});

test('quoted table names are supported without breaking the reference syntax', () => {
  const schema = '"Auth Users" {\n  id int [pk]\n}\n\nOrders {\n  id int [pk]\n  user_id int\n}';
  const created = createVisualConnection(schema, endpoint('Auth Users', 'id'), endpoint('Orders', 'user_id'));
  assert.equal(created.status, 'created');
  assert.deepEqual(ids(created.text), ['Orders.user_id->Auth Users.id']);
});

test('edits retain CRLF line endings', () => {
  const crlf = inline.replace(/\n/g, '\r\n');
  const created = createVisualConnection(crlf, parent, child);
  assert.equal(created.status, 'created');
  assert.ok(created.text.split('\n').slice(0, -1).every((line) => line.endsWith('\r')));
});

test('legacy references after a bracket list can be replaced safely', () => {
  const legacy = bracketed.replace(
    '  user_id int [null, index, default:0, note:"owner, FK >- users.id"] // keep this comment',
    '  user_id int [null, index, note:"owner"] FK >- users.id',
  );
  const result = createVisualConnection(legacy, endpoint('comments', 'id'), endpoint('posts', 'user_id'));
  assert.equal(result.status, 'updated');
  assert.deepEqual(ids(result.text), ['posts.user_id->comments.id']);
  assert.equal(column(result.text, 'posts', 'user_id').note, 'owner');
});

test('drop hit-testing accepts both edges and vertical layouts without moving tables', () => {
  const { tables } = parseSchema(inline);
  for (const postsPosition of [{ x: 450, y: 70 }, { x: -350, y: 70 }, { x: 30, y: 400 }]) {
    const positions = { Users: { x: 20, y: 20 }, Posts: postsPosition, Comments: { x: 750, y: 400 } };
    const snapshot = JSON.stringify(positions);
    const posts = tables.find((table) => table.name === 'Posts')!;
    const rect = tableRect(posts, positions);
    const y = rect.y + rowCenterY(1);
    for (const side of [-1, 1] as const) {
      const x = side === -1 ? rect.x - 5 : rect.x + rect.w + 5;
      const hit = hitColumn(tables, positions, { x, y });
      assert.equal(hit?.table, 'Posts');
      assert.equal(hit?.col, 'user_id');
      assert.equal(hit?.side, side);
    }
    assert.equal(hitColumn(tables, positions, { x: rect.x + 20, y: rect.y + 10 }), null);
    const created = createVisualConnection(inline, parent, child);
    assert.deepEqual(placeNewTables(parseSchema(created.text).tables, positions), positions);
    assert.equal(JSON.stringify(positions), snapshot);
  }
});

test('all connector styles route correctly with tables on either side', () => {
  const a = { x: 0, y: 0, w: 200, h: 120 };
  const b = { x: 400, y: 180, w: 200, h: 120 };
  for (const [from, to] of [[a, b], [b, a]]) {
    const anchors = computeAnchors(from, from.y + 46, to, to.y + 70);
    for (const style of ['orthogonal', 'curved', 'straight'] as const) {
      const path = buildConnector(style, anchors[0], anchors[1], from, to, false);
      assert.ok(path.d.startsWith(`M ${anchors[0].x} ${anchors[0].y}`));
      assert.ok(!/NaN|undefined|Infinity/.test(path.d));
      assert.ok(Number.isFinite(path.label.x) && Number.isFinite(path.label.y));
    }
  }
});