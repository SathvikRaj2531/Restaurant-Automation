// Menu management (owner / manager). Soft delete only; stored orders keep their own name and price snapshots,
// so editing or deleting a menu item can never change an existing order.
const express = require('express');
const { db, tx } = require('../db');
const { requireAuth } = require('../auth');
const { HttpError } = require('../util');

const router = express.Router();
router.use(requireAuth('owner', 'manager'));
router.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });

const text = (v, max, label, required) => {
  const t = String(v ?? '').replace(/\s+/g, ' ').trim();
  if (required && !t) throw new HttpError(400, `${label} is required.`);
  if (t.length > max) throw new HttpError(400, `${label} must be at most ${max} characters.`);
  return t;
};
const id = (req) => {
  const n = Number(req.params.id);
  if (!Number.isInteger(n)) throw new HttpError(400, 'Invalid id.');
  return n;
};

function parseItem(b) {
  const name = text(b?.name, 100, 'Name', true);
  const description = String(b?.description ?? '').trim().slice(0, 500);
  const subcategory = text(b?.subcategory, 60, 'Subcategory', false);
  const category_id = Number(b?.category_id);
  if (!Number.isInteger(category_id) || !db.prepare('SELECT 1 FROM menu_categories WHERE id = ?').get(category_id)) throw new HttpError(400, 'Choose a category.');
  if (typeof b?.is_veg !== 'boolean') throw new HttpError(400, 'Choose veg or non-veg.');

  if (!Array.isArray(b?.portions) || !b.portions.length) throw new HttpError(400, 'Add at least one portion.');
  if (b.portions.length > 6) throw new HttpError(400, 'At most 6 portions per item.');
  const seen = new Set();
  const portions = b.portions.map((p) => {
    const label = text(p?.label, 30, 'Portion label', true);
    if (seen.has(label.toLowerCase())) throw new HttpError(400, `Portion "${label}" is listed twice.`);
    seen.add(label.toLowerCase());
    let price = null; // empty = "Price to be confirmed" (not orderable)
    if (p?.price !== null && p?.price !== undefined && p?.price !== '') {
      price = Number(p.price);
      if (!Number.isInteger(price) || price < 0 || price > 1000000) throw new HttpError(400, `Price for "${label}" must be a whole number of rupees.`);
    }
    return { label, price };
  });

  let image_url = String(b?.image_url ?? '').trim();
  if (image_url) {
    if (image_url.length > 500 || !/^https?:\/\/\S+$/i.test(image_url)) throw new HttpError(400, 'Image URL must start with http:// or https://.');
  }
  return { name, description, subcategory, category_id, is_veg: b.is_veg ? 1 : 0, portions: JSON.stringify(portions),
    special: b?.special ? 1 : 0, available: b?.available === false ? 0 : 1, image_url: image_url || null };
}

/** menu_items has UNIQUE(category_id, name). A soft-deleted item must not block its name from being reused. */
function freeName(categoryId, name, exceptId) {
  const clash = db.prepare('SELECT id, deleted_at FROM menu_items WHERE category_id = ? AND name = ? AND id != ?').get(categoryId, name, exceptId);
  if (!clash) return;
  if (!clash.deleted_at) throw new HttpError(409, `"${name}" already exists in that category.`);
  db.prepare('UPDATE menu_items SET name = ? WHERE id = ?').run(`${name} (deleted #${clash.id})`, clash.id);
}

const itemRow = (it) => ({
  id: it.id, category_id: it.category_id, name: it.name, description: it.description || '', subcategory: it.subcategory || '',
  is_veg: !!it.is_veg, portions: JSON.parse(it.portions), available: !!it.available, special: !!it.special, image_url: it.image_url || '',
});

router.get('/', (req, res) => {
  const cats = db.prepare('SELECT id, name, sort_order FROM menu_categories ORDER BY sort_order, id').all();
  const items = db.prepare('SELECT * FROM menu_items WHERE deleted_at IS NULL ORDER BY sort_order, id').all();
  res.json({ categories: cats.map((c) => ({ ...c, items: items.filter((i) => i.category_id === c.id).map(itemRow) })) });
});

router.post('/items', (req, res) => {
  const f = parseItem(req.body);
  const created = tx(() => {
    freeName(f.category_id, f.name, 0);
    const order = Number(db.prepare('SELECT COALESCE(MAX(sort_order), 0) + 1 AS n FROM menu_items WHERE category_id = ?').get(f.category_id).n);
    const r = db.prepare(
      `INSERT INTO menu_items (category_id, name, description, subcategory, is_veg, portions, available, special, image_url, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(f.category_id, f.name, f.description || null, f.subcategory || null, f.is_veg, f.portions, f.available, f.special, f.image_url, order);
    return Number(r.lastInsertRowid);
  });
  res.status(201).json({ item: itemRow(db.prepare('SELECT * FROM menu_items WHERE id = ?').get(created)) });
});

router.put('/items/:id', (req, res) => {
  const itemId = id(req);
  const f = parseItem(req.body);
  tx(() => {
    const cur = db.prepare('SELECT * FROM menu_items WHERE id = ? AND deleted_at IS NULL').get(itemId);
    if (!cur) throw new HttpError(404, 'Item not found.');
    freeName(f.category_id, f.name, itemId);
    const moved = cur.category_id !== f.category_id;
    const order = moved ? Number(db.prepare('SELECT COALESCE(MAX(sort_order), 0) + 1 AS n FROM menu_items WHERE category_id = ?').get(f.category_id).n) : cur.sort_order;
    db.prepare(
      `UPDATE menu_items SET category_id = ?, name = ?, description = ?, subcategory = ?, is_veg = ?, portions = ?, available = ?, special = ?, image_url = ?, sort_order = ? WHERE id = ?`
    ).run(f.category_id, f.name, f.description || null, f.subcategory || null, f.is_veg, f.portions, f.available, f.special, f.image_url, order, itemId);
  });
  res.json({ item: itemRow(db.prepare('SELECT * FROM menu_items WHERE id = ?').get(itemId)) });
});

// Quick toggles from the list
router.patch('/items/:id', (req, res) => {
  const itemId = id(req);
  const sets = [];
  const vals = [];
  for (const key of ['available', 'special']) {
    if (key in (req.body || {})) {
      if (typeof req.body[key] !== 'boolean') throw new HttpError(400, `${key} must be true or false.`);
      sets.push(`${key} = ?`); vals.push(req.body[key] ? 1 : 0);
    }
  }
  if (!sets.length) throw new HttpError(400, 'Nothing to change.');
  const r = db.prepare(`UPDATE menu_items SET ${sets.join(', ')} WHERE id = ? AND deleted_at IS NULL`).run(...vals, itemId);
  if (!Number(r.changes)) throw new HttpError(404, 'Item not found.');
  res.json({ item: itemRow(db.prepare('SELECT * FROM menu_items WHERE id = ?').get(itemId)) });
});

// Soft delete
router.delete('/items/:id', (req, res) => {
  const r = db.prepare("UPDATE menu_items SET deleted_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ? AND deleted_at IS NULL").run(id(req));
  if (!Number(r.changes)) throw new HttpError(404, 'Item not found.');
  res.json({ ok: true });
});

// ---- Categories: add, rename, reorder ----
router.post('/categories', (req, res) => {
  const name = text(req.body?.name, 60, 'Category name', true);
  if (db.prepare('SELECT 1 FROM menu_categories WHERE name = ?').get(name)) throw new HttpError(409, 'A category with that name already exists.');
  const order = Number(db.prepare('SELECT COALESCE(MAX(sort_order), 0) + 1 AS n FROM menu_categories').get().n);
  const r = db.prepare('INSERT INTO menu_categories (name, sort_order) VALUES (?, ?)').run(name, order);
  res.status(201).json({ category: { id: Number(r.lastInsertRowid), name, sort_order: order } });
});

router.put('/categories/:id', (req, res) => {
  const catId = id(req);
  const name = text(req.body?.name, 60, 'Category name', true);
  if (db.prepare('SELECT 1 FROM menu_categories WHERE name = ? AND id != ?').get(name, catId)) throw new HttpError(409, 'A category with that name already exists.');
  const r = db.prepare('UPDATE menu_categories SET name = ? WHERE id = ?').run(name, catId);
  if (!Number(r.changes)) throw new HttpError(404, 'Category not found.');
  res.json({ ok: true });
});

router.post('/categories/:id/move', (req, res) => {
  const catId = id(req);
  const dir = req.body?.direction;
  if (dir !== 'up' && dir !== 'down') throw new HttpError(400, 'Direction must be up or down.');
  tx(() => {
    const ids = db.prepare('SELECT id FROM menu_categories ORDER BY sort_order, id').all().map((r) => r.id);
    const i = ids.indexOf(catId);
    if (i < 0) throw new HttpError(404, 'Category not found.');
    const j = dir === 'up' ? i - 1 : i + 1;
    if (j >= 0 && j < ids.length) [ids[i], ids[j]] = [ids[j], ids[i]];
    ids.forEach((cid, k) => db.prepare('UPDATE menu_categories SET sort_order = ? WHERE id = ?').run(k + 1, cid));
  });
  res.json({ ok: true });
});

module.exports = router;
