const { db } = require('./db');

/** Original illustrations used until a real photo URL is set on an item (public/img/art/*.svg). */
function defaultArt(categoryName, isVeg) {
  const c = String(categoryName || '').toLowerCase();
  const name = /soup/.test(c) ? 'soup'
    : /kabab|kebab|tikka|tandoor|grill/.test(c) ? (isVeg ? 'kabab-veg' : 'kabab')
    : /starter/.test(c) ? (isVeg ? 'starter-veg' : 'starter')
    : /noodle/.test(c) ? 'noodles' : 'generic';
  return `/img/art/${name}.svg`;
}

function getSettings() {
  return db.prepare('SELECT * FROM settings WHERE id = 1').get();
}

/** Public menu: hides deleted items, includes availability. Price null = "Price to be confirmed". */
function getPublicMenu() {
  const categories = db.prepare('SELECT id, name, sort_order FROM menu_categories ORDER BY sort_order, id').all();
  const items = db.prepare('SELECT * FROM menu_items WHERE deleted_at IS NULL ORDER BY sort_order, id').all();
  const byCategory = new Map(categories.map((c) => [c.id, { id: c.id, name: c.name, items: [] }]));
  for (const it of items) {
    const portions = JSON.parse(it.portions);
    const available = !!it.available;
    byCategory.get(it.category_id)?.items.push({
      id: it.id,
      name: it.name,
      description: it.description || '',
      subcategory: it.subcategory || '',
      is_veg: !!it.is_veg,
      portions,
      available,
      special: !!it.special,
      image_url: it.image_url || defaultArt(byCategory.get(it.category_id)?.name, !!it.is_veg),
      has_photo: !!it.image_url,
      orderable: available && portions.some((p) => Number.isInteger(p.price)),
    });
  }
  return { categories: [...byCategory.values()].filter((c) => c.items.length) };
}

module.exports = { getSettings, getPublicMenu, defaultArt };
