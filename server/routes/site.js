const express = require('express');
const { db } = require('../db');
const { getSettings, getPublicMenu, defaultArt } = require('../data');
const { baseUrl } = require('../util');
const V = require('../views');

const router = express.Router();

function context(req) {
  const specials = db.prepare(
    `SELECT i.name, i.is_veg, i.portions, i.image_url, c.name AS category FROM menu_items i JOIN menu_categories c ON c.id = i.category_id
     WHERE i.special = 1 AND i.available = 1 AND i.deleted_at IS NULL ORDER BY c.sort_order, i.sort_order, i.id LIMIT 6`
  ).all().map((r) => ({ ...r, is_veg: !!r.is_veg, portions: JSON.parse(r.portions), image_url: r.image_url || defaultArt(r.category, !!r.is_veg) }));
  return { s: getSettings(), base: baseUrl(req), specials, menu: getPublicMenu() };
}

const page = (render) => (req, res) => {
  res.set('Cache-Control', 'no-cache');
  res.type('html').send(render(context(req)));
};

router.get('/', page(V.home));
router.get('/menu', page(V.menu));
router.get('/about', page(V.about));
router.get('/contact', page(V.contact));

router.get('/robots.txt', (req, res) => {
  res.type('text/plain').send(
    ['User-agent: *', 'Allow: /', 'Disallow: /staff', 'Disallow: /kitchen', 'Disallow: /waiter', 'Disallow: /t/', 'Disallow: /api/', '', `Sitemap: ${baseUrl(req)}/sitemap.xml`, ''].join('\n')
  );
});

router.get('/sitemap.xml', (req, res) => {
  const base = baseUrl(req);
  const lastmod = new Date().toISOString().slice(0, 10);
  const pages = [['/', '1.0', 'weekly'], ['/menu', '0.9', 'daily'], ['/about', '0.5', 'monthly'], ['/contact', '0.7', 'monthly']];
  const urls = pages.map(([p, pr, cf]) => `  <url><loc>${base}${p === '/' ? '/' : p}</loc><lastmod>${lastmod}</lastmod><changefreq>${cf}</changefreq><priority>${pr}</priority></url>`).join('\n');
  res.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`);
});

// Plain-language summary for AI assistants and answer engines (llms.txt convention). Facts only, taken from settings and the menu.
router.get('/llms.txt', (req, res) => {
  const s = getSettings();
  const base = baseUrl(req);
  const menu = getPublicMenu();
  const lines = [
    `# ${s.restaurant_name}`, '',
    `> ${s.restaurant_name} is a restaurant in Old Bowenpally, Secunderabad, Telangana, India serving kababs, starters, soups and noodles, vegetarian and non-vegetarian.`, '',
    '## Facts',
    `- Address: ${s.address}`,
    `- Opening hours: ${s.hours}`,
    '- Ordering: guests scan the QR code on their table to order; staff take payment by cash, UPI or card.',
    '- Currency: Indian rupees (INR).', '',
    '## Menu categories',
    ...menu.categories.map((c) => `- ${c.name}: ${c.items.length} dishes`), '',
    '## Pages',
    `- [Home](${base}/)`, `- [Menu and prices](${base}/menu)`, `- [About](${base}/about)`, `- [Contact and directions](${base}/contact)`, '',
  ];
  res.type('text/plain').send(lines.join('\n'));
});

router.get('/manifest.webmanifest', (req, res) => {
  const s = getSettings();
  res.type('application/manifest+json').send(JSON.stringify({
    name: s.restaurant_name, short_name: 'P Cube', start_url: '/', display: 'standalone', lang: 'en-IN',
    theme_color: '#15100d', background_color: '#15100d',
    icons: [{ src: '/img/icon-192.png', sizes: '192x192', type: 'image/png' }, { src: '/img/icon-512.png', sizes: '512x512', type: 'image/png' }],
  }));
});

/** Final fallback: JSON 404 for /api, styled 404 page for everything else. */
router.notFoundHandler = (req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Not found.' });
  res.status(404).type('html').send(V.notFound(context(req)));
};

module.exports = router;
