// Re-runnable, safe seed: only inserts what is missing, never overwrites or duplicates.
const crypto = require('crypto');
const S = require('./settings');
const { db, tx } = require('./db');
const { hashPassword } = require('./auth');
const MENU = require('./menuData');

const PLACEHOLDERS = {
  phone: '[ADD PHONE NUMBER]',
  whatsapp: '[ADD WHATSAPP NUMBER]',
  gstin: '[ADD GSTIN]',
  tagline: '[ADD TAGLINE]',
  about_text: '[ADD ABOUT TEXT]',
  maps_link: '[ADD GOOGLE MAPS LINK]',
  reviews_source: '[ADD REVIEWS SOURCE]',
  instagram: '[ADD LINK]',
  facebook: '[ADD LINK]',
};

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
const tempPassword = () => Array.from(crypto.randomBytes(10), (b) => ALPHABET[b % ALPHABET.length]).join('');

function seedSettings() {
  if (db.prepare('SELECT 1 FROM settings WHERE id = 1').get()) return;
  db.prepare(
    `INSERT INTO settings (id, restaurant_name, address, hours, phone, whatsapp, gstin, tagline, about_text,
       maps_link, reviews_source, instagram, facebook, tax_percent, service_charge_percent)
     VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL)`
  ).run(
    'P Cube Charcoal Food Den',
    'Sai Nagar, Indira Nagar, Old Bowenpally, Secunderabad, Telangana 500015',
    '11:00 AM – 12:00 AM',
    PLACEHOLDERS.phone, PLACEHOLDERS.whatsapp, PLACEHOLDERS.gstin, PLACEHOLDERS.tagline, PLACEHOLDERS.about_text,
    PLACEHOLDERS.maps_link, PLACEHOLDERS.reviews_source, PLACEHOLDERS.instagram, PLACEHOLDERS.facebook
  );
}

function seedTables() {
  const added = [];
  for (let n = 1; n <= S.TABLE_COUNT; n++) {
    if (db.prepare('SELECT 1 FROM dining_tables WHERE number = ?').get(n)) continue;
    db.prepare('INSERT INTO dining_tables (number, qr_token) VALUES (?, ?)').run(n, crypto.randomBytes(16).toString('base64url'));
    added.push(n);
  }
  return added;
}

function seedUsers() {
  const created = [];
  for (const role of S.ROLES) {
    if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(role)) continue;
    const password = tempPassword();
    db.prepare('INSERT INTO users (username, name, role, password_hash, must_change_password) VALUES (?,?,?,?,1)')
      .run(role, role[0].toUpperCase() + role.slice(1), role, hashPassword(password));
    created.push({ username: role, role, password });
  }
  return created;
}

function seedMenu() {
  // Only seed an empty menu. Once the owner edits the menu (rename, delete, new categories), a restart must never bring seed items back.
  if (db.prepare('SELECT 1 FROM menu_items LIMIT 1').get()) return 0;
  let added = 0;
  MENU.forEach((cat, ci) => {
    db.prepare('INSERT OR IGNORE INTO menu_categories (name, sort_order) VALUES (?, ?)').run(cat.category, ci + 1);
    const categoryId = db.prepare('SELECT id FROM menu_categories WHERE name = ?').get(cat.category).id;
    let order = 0;
    for (const group of cat.groups) {
      for (const [name, portions] of group.items) {
        order += 1;
        const r = db.prepare(
          `INSERT OR IGNORE INTO menu_items (category_id, name, subcategory, is_veg, portions, available, special, sort_order)
           VALUES (?, ?, ?, ?, ?, 1, 0, ?)`
        ).run(categoryId, name, group.sub, group.veg ? 1 : 0, JSON.stringify(portions), order);
        added += Number(r.changes);
      }
    }
  });
  return added;
}

function runSeed() {
  return tx(() => {
    seedSettings();
    const tables = seedTables();
    const users = seedUsers();
    const items = seedMenu();
    return { tables, users, items };
  });
}

module.exports = { runSeed };

if (require.main === module) {
  const r = runSeed();
  console.log(`Seed done. New tables: ${r.tables.length}, new menu items: ${r.items}, new users: ${r.users.length}`);
  if (r.users.length) {
    console.log('\nTEMPORARY LOGINS (shown once; users must change password at first login):');
    for (const u of r.users) console.log(`  ${u.role.padEnd(8)} username: ${u.username.padEnd(8)} password: ${u.password}`);
  }
}
