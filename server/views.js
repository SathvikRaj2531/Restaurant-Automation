// Server-rendered HTML for the public website (Home, Menu, About, Contact, 404). SEO lives here:
// unique titles/descriptions, canonical + hreflang, Open Graph/Twitter, JSON-LD, server-rendered menu.
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const isPlaceholder = (v) => !v || /^\s*\[.*\]\s*$/.test(v);
const fmtINR = (n) => '₹' + Number(n).toLocaleString('en-IN');
const json = (o) => JSON.stringify(o).replace(/</g, '\\u003c');

const NAV = [['/', 'Home'], ['/menu', 'Menu'], ['/about', 'About'], ['/contact', 'Contact']];
const FONTS = 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Playfair+Display:wght@600;700;800&display=swap';
const LOGO = '<svg class="logo" viewBox="0 0 32 32" width="30" height="30" aria-hidden="true" focusable="false"><rect width="32" height="32" rx="8" fill="currentColor" opacity=".14"/><path d="M16 4c1 5 7 8 7 15a7 7 0 0 1-14 0c0-3 1.6-5 3.2-6.6.2 2 1.2 3 2.2 3.4C14 12 14.6 8 16 4z" fill="var(--color-accent)"/><path d="M16 17c.6 2.2 3 3.3 3 6a3 3 0 0 1-6 0c0-1.6 1-2.6 1.8-3.4.4.8.8 1 1.2 1 0-1.2 0-2.4 0-3.6z" fill="var(--color-brand)"/></svg>';

const img = (src, alt, w, h, { cls = '', eager = false } = {}) =>
  `<img${cls ? ` class="${cls}"` : ''} src="${esc(src)}" alt="${esc(alt)}" width="${w}" height="${h}"${eager ? ' fetchpriority="high"' : ' loading="lazy"'} decoding="async">`;

function phoneLink(s) {
  return isPlaceholder(s.phone)
    ? `<span class="placeholder-text">${esc(s.phone)}</span>`
    : `<a href="tel:${esc(s.phone.replace(/[^\d+]/g, ''))}">${esc(s.phone)}</a>`;
}
function whatsappButton(s, label = 'WhatsApp') {
  if (isPlaceholder(s.whatsapp)) {
    return `<span class="btn btn-whatsapp btn-sm is-placeholder" title="${esc(s.whatsapp)}">${esc(label)} <small>${esc(s.whatsapp)}</small></span>`;
  }
  return `<a class="btn btn-whatsapp btn-sm" href="https://wa.me/${esc(s.whatsapp.replace(/\D/g, ''))}" target="_blank" rel="noopener">${esc(label)}</a>`;
}
function socialLinks(s) {
  return [['Instagram', s.instagram], ['Facebook', s.facebook]].map(([name, url]) =>
    isPlaceholder(url)
      ? `<span class="placeholder-text">${name} ${esc(url)}</span>`
      : `<a href="${esc(url)}" target="_blank" rel="noopener me">${name}</a>`).join(' ');
}

/** "11:00 AM – 12:00 AM" -> { opens: '11:00', closes: '00:00' } (null if it cannot be read). */
function parseHours(h) {
  const m = /(\d{1,2}):(\d{2})\s*([AP]M)\s*[–—-]\s*(\d{1,2}):(\d{2})\s*([AP]M)/i.exec(h || '');
  if (!m) return null;
  const t = (hh, mm, ap) => `${String((Number(hh) % 12) + (/p/i.test(ap) ? 12 : 0)).padStart(2, '0')}:${mm}`;
  return { opens: t(m[1], m[2], m[3]), closes: t(m[4], m[5], m[6]) };
}

function restaurantJsonLd(s, base, extra = {}) {
  const parts = s.address.split(',').map((p) => p.trim());
  const m = /^(.*?)\s*(\d{6})$/.exec(parts[parts.length - 1] || '');
  const address = m && parts.length >= 3
    ? { '@type': 'PostalAddress', streetAddress: parts.slice(0, -2).join(', '), addressLocality: parts[parts.length - 2], addressRegion: m[1], postalCode: m[2], addressCountry: 'IN' }
    : { '@type': 'PostalAddress', streetAddress: s.address, addressCountry: 'IN' };
  const hours = parseHours(s.hours);
  const data = {
    '@context': 'https://schema.org',
    '@type': 'Restaurant',
    '@id': base + '/#restaurant',
    name: s.restaurant_name,
    url: base + '/',
    image: [base + '/img/og-card.jpg', base + '/img/art/hero.svg'],
    description: `${s.restaurant_name} in Old Bowenpally, Secunderabad serves kababs, starters, soups and noodles, vegetarian and non-vegetarian.`,
    servesCuisine: ['Indian', 'Indo-Chinese', 'Kebabs'],
    address,
    menu: base + '/menu',
    hasMenu: base + '/menu',
    ...extra,
  };
  if (!isPlaceholder(s.phone)) data.telephone = s.phone;
  if (hours) data.openingHoursSpecification = [{ '@type': 'OpeningHoursSpecification', dayOfWeek: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'], opens: hours.opens, closes: hours.closes }];
  if (!isPlaceholder(s.maps_link)) data.hasMap = s.maps_link;
  const sameAs = [s.instagram, s.facebook].filter((u) => !isPlaceholder(u));
  if (sameAs.length) data.sameAs = sameAs;
  return data;
}

function layout({ s, base, path, title, description, body, scripts = '', styles = [], jsonld = [], noindex = false, preload = '' }) {
  const nav = NAV.map(([href, label]) => `<a href="${href}"${href === path ? ' aria-current="page"' : ''}>${label}</a>`).join('');
  const url = esc(base + (path === '/' ? '/' : path));
  const ogImg = esc(base + '/img/og-card.jpg');
  return `<!doctype html>
<html lang="en-IN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
${noindex ? '<meta name="robots" content="noindex, nofollow">' : `<meta name="robots" content="index, follow, max-image-preview:large">
<link rel="canonical" href="${url}">
<link rel="alternate" hreflang="en-IN" href="${url}">
<link rel="alternate" hreflang="x-default" href="${url}">
<meta property="og:type" content="${path === '/' ? 'restaurant.restaurant' : 'website'}">
<meta property="og:site_name" content="${esc(s.restaurant_name)}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${url}">
<meta property="og:locale" content="en_IN">
<meta property="og:image" content="${ogImg}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="${esc(s.restaurant_name)}: charcoal-grilled kababs over glowing coals">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(description)}">
<meta name="twitter:image" content="${ogImg}">`}
<meta name="theme-color" content="#15100d">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="icon" href="/img/icon-192.png" sizes="192x192" type="image/png">
<link rel="apple-touch-icon" href="/img/apple-touch-icon.png">
<link rel="manifest" href="/manifest.webmanifest">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="${FONTS}">
${preload}
<link rel="stylesheet" href="/css/theme.css">
<link rel="stylesheet" href="/css/app.css">
<link rel="stylesheet" href="/css/site.css">
${styles.map((f) => `<link rel="stylesheet" href="${f}">`).join('\n')}
${jsonld.map((d) => `<script type="application/ld+json">${json(d)}</script>`).join('\n')}
</head>
<body>
<a class="skip" href="#main">Skip to content</a>
<div class="topbar"><div class="wrap topbar-inner">
  <span>Open ${esc(s.hours)}</span>
  <span class="topbar-right"><span class="hide-sm">${esc(s.address.split(',').slice(0, 3).join(','))}</span> <span>${phoneLink(s)}</span></span>
</div></div>
<header class="site-header">
  <div class="wrap header-inner">
    <a class="brand" href="/" aria-label="${esc(s.restaurant_name)} home">${LOGO}<span>${esc(s.restaurant_name)}</span></a>
    <nav class="site-nav" aria-label="Main">${nav}</nav>
    <span class="header-cta">${whatsappButton(s)}</span>
  </div>
</header>
<main id="main">
${body}
</main>
<footer class="site-footer">
  <div class="wrap footer-grid">
    <div>
      <p class="footer-brand">${LOGO}<span>${esc(s.restaurant_name)}</span></p>
      <p class="footer-about">Charcoal kababs, starters, soups and noodles in Old Bowenpally, Secunderabad.</p>
      <p class="social">${socialLinks(s)}</p>
    </div>
    <div>
      <h2>Visit</h2>
      <address>${esc(s.address)}</address>
      <p>Open ${esc(s.hours)}</p>
    </div>
    <div>
      <h2>Contact</h2>
      <p>Phone: ${phoneLink(s)}</p>
      <p>${whatsappButton(s, 'WhatsApp us')}</p>
    </div>
    <div>
      <h2>Explore</h2>
      <p class="footer-nav">${nav}</p>
    </div>
  </div>
  <div class="wrap footer-copy">&copy; ${new Date().getFullYear()} ${esc(s.restaurant_name)}. All rights reserved.</div>
</footer>
${scripts}
</body>
</html>`;
}

function portionsText(portions) {
  const single = portions.length === 1 && portions[0].label === 'Regular';
  return portions.map((p) => {
    const price = Number.isInteger(p.price) ? fmtINR(p.price) : 'Price to be confirmed';
    return single ? price : `${esc(p.label)} ${price}`;
  }).join(' &middot; ');
}

const CAT_BLURB = {
  soup: 'Hot bowls, vegetarian and non-vegetarian',
  kabab: 'Tikkas and kababs from the charcoal grill',
  starter: 'Manchurian, 65, lollipops and more',
  noodle: 'Hakka, Singapore, Hong Kong and more',
};
const catKey = (name) => Object.keys(CAT_BLURB).find((k) => new RegExp(k, 'i').test(name)) || '';
const catArt = (name) => ({ soup: 'soup', kabab: 'kabab', starter: 'starter', noodle: 'noodles' }[catKey(name)] || 'generic');
const slug = (t) => String(t).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

const FAQ = (s) => [
  ['Where is P Cube Charcoal Food Den located?', `We are at ${s.address}.`],
  ['What are your opening hours?', `We are open ${s.hours}.`],
  ['What can I eat at P Cube Charcoal Food Den?', 'Our menu has soups, kababs, starters and noodles, with separate vegetarian and non-vegetarian choices. Browse the full menu with prices on our Menu page.'],
  ['Do you have vegetarian options?', 'Yes. Every category has vegetarian dishes, marked with a green symbol on the menu. Non-vegetarian dishes carry a red symbol.'],
  ['Can I order from my table?', 'Yes. Scan the QR code on your table, choose your dishes, add notes such as "make it more spicy", and place the order. You can order again at any time and see the live status of each order.'],
  ['How do I pay?', 'Staff take the payment at your table or at the counter in cash, by UPI or by card, and you receive a printed bill.'],
];

function home(ctx) {
  const { s, base, specials, menu } = ctx;
  const sub = isPlaceholder(s.tagline)
    ? 'Charcoal kababs, starters, soups and noodles, vegetarian and non-vegetarian, served fresh at your table.'
    : s.tagline;
  const cats = menu.categories;
  const catTiles = cats.map((c) => `
    <a class="cat-tile" href="/menu#${slug(c.name)}">
      ${img(`/img/art/${catArt(c.name)}.svg`, `${c.name} at ${s.restaurant_name}`, 800, 600)}
      <span class="cat-info"><strong>${esc(c.name)}</strong><small>${esc(CAT_BLURB[catKey(c.name)] || '')} &middot; ${c.items.length} dishes</small></span>
    </a>`).join('');
  const specialsHtml = specials.length ? `
<section class="section" aria-labelledby="sp-h"><div class="wrap">
  <p class="eyebrow">Chef's picks</p><h2 id="sp-h">Today's specials</h2>
  <div class="grid grid-3">${specials.map((it) => `
    <article class="card special">
      ${img(it.image_url, it.name, 800, 600)}
      <h3><span class="vn ${it.is_veg ? 'veg' : 'nonveg'}" role="img" aria-label="${it.is_veg ? 'Veg' : 'Non-veg'}"></span> ${esc(it.name)}</h3>
      <p class="price-line">${portionsText(it.portions)}</p>
    </article>`).join('')}</div>
</div></section>` : '';
  const gallery = [['grill', 'Glowing charcoal and flames'], ['kabab', 'Chicken tikka skewers'], ['noodles', 'Noodles with vegetables'], ['soup', 'A steaming bowl of soup'], ['starter-veg', 'Vegetable Manchurian'], ['ambience', 'Warm lamps over the table']]
    .map(([f, alt]) => `<figure>${img(`/img/art/${f}.svg`, alt, 800, 600)}<figcaption>${esc(alt)}</figcaption></figure>`).join('');
  const faq = FAQ(s);
  const reviews = isPlaceholder(s.reviews_source) ? '' : `
<section class="section alt"><div class="wrap center">
  <p class="eyebrow">Guest love</p><h2>Google reviews</h2>
  <p><a class="btn" href="${esc(s.reviews_source)}" target="_blank" rel="noopener">Read our Google reviews</a></p>
</div></section>`;
  const body = `
<section class="hero">
  ${img('/img/art/hero.svg', `Skewers of kababs grilling over glowing charcoal at ${s.restaurant_name}`, 1600, 900, { cls: 'hero-img', eager: true })}
  <div class="hero-shade"></div>
  <div class="wrap hero-inner">
    <p class="eyebrow on-dark">Old Bowenpally &middot; Secunderabad</p>
    <h1>${esc(s.restaurant_name)}</h1>
    <p class="hero-sub">${esc(sub)}</p>
    <p class="hero-actions"><a class="btn btn-accent btn-lg" href="/menu">Explore the menu</a><a class="btn btn-ghost-light btn-lg" href="/contact">Find us</a></p>
    <ul class="hero-facts">
      <li><span aria-hidden="true">&#9719;</span> Open ${esc(s.hours)}</li>
      <li><span aria-hidden="true">&#127811;</span> Veg &amp; non-veg</li>
      <li><span aria-hidden="true">&#9638;</span> Scan the table QR to order</li>
    </ul>
  </div>
</section>

<section class="section" aria-labelledby="cat-h"><div class="wrap">
  <p class="eyebrow">What we serve</p><h2 id="cat-h">From the charcoal grill and the wok</h2>
  <div class="cat-grid">${catTiles}</div>
</div></section>
${specialsHtml}
<section class="section dark" aria-labelledby="how-h"><div class="wrap">
  <p class="eyebrow on-dark">Dine with us</p><h2 id="how-h">Order from your table in three steps</h2>
  <ol class="steps">
    <li><span class="step-n">1</span><strong>Scan</strong><span>Scan the QR code on your table.</span></li>
    <li><span class="step-n">2</span><strong>Choose</strong><span>Pick dishes and portions, add a note for the kitchen.</span></li>
    <li><span class="step-n">3</span><strong>Enjoy</strong><span>Follow your order live. Pay at the table by cash, UPI or card.</span></li>
  </ol>
</div></section>

<section class="section alt" aria-labelledby="visit-h"><div class="wrap grid grid-2">
  <div class="card info-card"><p class="eyebrow">Opening hours</p><h2 id="visit-h">${esc(s.hours)}</h2><p class="muted">Walk in, or scan and order straight from your table.</p></div>
  <div class="card info-card"><p class="eyebrow">Find us</p><h2>Old Bowenpally</h2><address>${esc(s.address)}</address><p><a class="btn btn-sm" href="/contact">Directions and contact</a></p></div>
</div></section>

<section class="section" aria-labelledby="gal-h"><div class="wrap">
  <p class="eyebrow">Gallery</p><h2 id="gal-h">Fire, smoke and flavour</h2>
  <div class="gallery">${gallery}</div>
</div></section>

<section class="section alt" aria-labelledby="faq-h"><div class="wrap narrow">
  <p class="eyebrow">Good to know</p><h2 id="faq-h">Frequently asked questions</h2>
  ${faq.map(([q, a]) => `<details class="faq"><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join('')}
</div></section>
${reviews}`;
  return layout({
    s, base, path: '/', body,
    title: `${s.restaurant_name} | Kababs, Starters, Bowenpally`,
    description: `${s.restaurant_name}, Old Bowenpally, Secunderabad: charcoal kababs, starters, soups and noodles, veg and non-veg. Open ${s.hours}.`,
    preload: '<link rel="preload" as="image" href="/img/art/hero.svg" fetchpriority="high">',
    jsonld: [
      restaurantJsonLd(s, base),
      { '@context': 'https://schema.org', '@type': 'WebSite', name: s.restaurant_name, url: base + '/', inLanguage: 'en-IN' },
      { '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: faq.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })) },
    ],
  });
}

/** Server-rendered menu: crawlers and slow phones see real dishes; menu-ui.js replaces it with the interactive version. */
function menuHtml(menu) {
  return menu.categories.map((c) => `
<section class="menu-cat" id="${slug(c.name)}"><h2>${esc(c.name)}</h2><div class="menu-items">${c.items.map((it) => `
  <article class="menu-item${it.available ? '' : ' is-unavailable'}">
    ${img(it.image_url, it.name, 96, 96, { cls: 'menu-thumb' })}
    <div class="menu-item-main">
      <div class="menu-item-name"><span class="vn ${it.is_veg ? 'veg' : 'nonveg'}" role="img" aria-label="${it.is_veg ? 'Veg' : 'Non-veg'}"></span><span>${esc(it.name)}</span></div>
      <div class="portions"><span class="portion">${portionsText(it.portions)}</span></div>
      ${it.available ? '' : '<span class="badge-unavailable">Currently unavailable</span>'}
    </div>
  </article>`).join('')}</div></section>`).join('');
}

function menuJsonLd(s, base, menu) {
  return {
    '@context': 'https://schema.org', '@type': 'Menu', name: `${s.restaurant_name} menu`, url: base + '/menu', inLanguage: 'en-IN',
    hasMenuSection: menu.categories.map((c) => ({
      '@type': 'MenuSection', name: c.name,
      hasMenuItem: c.items.map((it) => {
        const offers = it.portions.filter((p) => Number.isInteger(p.price)).map((p) => ({ '@type': 'Offer', price: p.price, priceCurrency: 'INR', ...(it.portions.length > 1 ? { name: p.label } : {}) }));
        return { '@type': 'MenuItem', name: it.name, ...(it.description ? { description: it.description } : {}),
          suitableForDiet: it.is_veg ? 'https://schema.org/VegetarianDiet' : undefined, image: base + it.image_url,
          ...(offers.length ? { offers: offers.length === 1 ? offers[0] : offers } : {}) };
      }),
    })),
  };
}

function menu(ctx) {
  const { s, base, menu: m } = ctx;
  const body = `
<section class="page-hero">
  ${img('/img/art/grill.svg', '', 800, 600, { cls: 'page-hero-img', eager: true })}
  <div class="hero-shade"></div>
  <div class="wrap page-hero-inner">
    <p class="eyebrow on-dark">${esc(s.restaurant_name)}</p>
    <h1>Our Menu</h1>
    <p class="hero-sub">Soups, kababs, starters and noodles. Prices in rupees. To order, scan the QR code on your table.</p>
  </div>
</section>
<section class="section"><div class="wrap">
  <div id="menu-root">${menuHtml(m)}</div>
  <noscript><p class="notice notice-warning">Search and filters need JavaScript. The full menu is listed above.</p></noscript>
</div></section>`;
  return layout({
    s, base, path: '/menu', body, styles: ['/css/menu.css'],
    title: `Menu & Prices | ${s.restaurant_name}`,
    description: `Full menu with prices in rupees: veg and non-veg soups, chicken and paneer kababs, Manchurian starters and noodles at ${s.restaurant_name}, Old Bowenpally.`,
    jsonld: [restaurantJsonLd(s, base), menuJsonLd(s, base, m)],
    scripts: `<script src="/js/common.js"></script>
<script src="/js/menu-ui.js"></script>
<script>MenuUI.mount(document.getElementById('menu-root'), { mode: 'browse' });
(function(){var h=location.hash.slice(1);if(!h)return;var t=0,i=setInterval(function(){var e=document.getElementById(h);if(e){e.scrollIntoView();clearInterval(i)}if(++t>20)clearInterval(i)},150)})();</script>`,
  });
}

function about(ctx) {
  const { s, base } = ctx;
  const story = isPlaceholder(s.about_text)
    ? `<p>${esc(s.restaurant_name)} is a charcoal-focused restaurant in Old Bowenpally, Secunderabad. Our menu brings together kababs and tikkas, starters, soups and noodles, with separate vegetarian and non-vegetarian choices.</p><p>Order straight from your table by scanning the QR code, follow your order live, and let our team take care of the rest.</p>`
    : `<p>${esc(s.about_text)}</p>`;
  const body = `
<section class="page-hero">
  ${img('/img/art/ambience.svg', '', 800, 600, { cls: 'page-hero-img', eager: true })}
  <div class="hero-shade"></div>
  <div class="wrap page-hero-inner"><p class="eyebrow on-dark">Our story</p><h1>About ${esc(s.restaurant_name)}</h1></div>
</section>
<section class="section"><div class="wrap grid grid-2 center-y">
  <div class="prose">${story}<p class="muted">${esc(s.restaurant_name)}<br>${esc(s.address)}</p><p><a class="btn" href="/menu">See the menu</a></p></div>
  ${img('/img/art/ambience.svg', `Warm pendant lamps over a table at ${s.restaurant_name}`, 800, 600, { cls: 'rounded' })}
</div></section>
<section class="section alt"><div class="wrap grid grid-3">
  <div class="card feature">${img('/img/art/kabab.svg', 'Kababs from the charcoal grill', 800, 600)}<h2>Charcoal kababs</h2><p>Tikkas and kababs, chicken and paneer.</p></div>
  <div class="card feature">${img('/img/art/noodles.svg', 'Noodles with vegetables', 800, 600)}<h2>Starters and noodles</h2><p>Manchurian, 65, lollipops, Hakka and Singapore noodles.</p></div>
  <div class="card feature">${img('/img/art/soup.svg', 'A bowl of soup', 800, 600)}<h2>Soups</h2><p>Vegetarian and non-vegetarian soups, served hot.</p></div>
</div></section>`;
  return layout({
    s, base, path: '/about', body,
    title: `About Us | ${s.restaurant_name}, Secunderabad`,
    description: `About ${s.restaurant_name}: charcoal kababs, starters, soups and noodles in Old Bowenpally, Secunderabad, with easy QR ordering at your table.`,
    jsonld: [restaurantJsonLd(s, base)],
  });
}

function contact(ctx) {
  const { s, base } = ctx;
  const real = !isPlaceholder(s.maps_link);
  const map = real && /\/maps\/embed/.test(s.maps_link)
    ? `<iframe class="map" src="${esc(s.maps_link)}" title="Map to ${esc(s.restaurant_name)}" loading="lazy" referrerpolicy="no-referrer-when-downgrade"></iframe>`
    : real
      ? `<p><a class="btn" href="${esc(s.maps_link)}" target="_blank" rel="noopener">Open in Google Maps</a></p>`
      : `<div class="map-ph" role="img" aria-label="Map coming soon"><span class="pin" aria-hidden="true">&#9906;</span><strong>${esc(s.restaurant_name)}</strong><span>${esc(s.address)}</span><small class="placeholder-text">Google Maps embed ${esc(s.maps_link)}</small></div>`;
  const body = `
<section class="page-hero">
  ${img('/img/art/grill.svg', '', 800, 600, { cls: 'page-hero-img', eager: true })}
  <div class="hero-shade"></div>
  <div class="wrap page-hero-inner"><p class="eyebrow on-dark">We would love to see you</p><h1>Contact &amp; Location</h1></div>
</section>
<section class="section"><div class="wrap grid grid-2">
  <div class="card info-card">
    <h2>Visit us</h2><address>${esc(s.address)}</address>
    <h2>Opening hours</h2><p>${esc(s.hours)}</p>
    <h2>Get in touch</h2>
    <p>Phone: ${phoneLink(s)}</p>
    <p>${whatsappButton(s, 'Chat on WhatsApp')}</p>
    <p class="social">${socialLinks(s)}</p>
  </div>
  <div>${map}</div>
</div></section>`;
  return layout({
    s, base, path: '/contact', body,
    title: `Contact, Hours & Directions | ${s.restaurant_name}`,
    description: `Address, opening hours and contact details for ${s.restaurant_name}, Sai Nagar, Indira Nagar, Old Bowenpally, Secunderabad, Telangana 500015.`,
    jsonld: [restaurantJsonLd(s, base), { '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: [{ '@type': 'ListItem', position: 1, name: 'Home', item: base + '/' }, { '@type': 'ListItem', position: 2, name: 'Contact', item: base + '/contact' }] }],
  });
}

function notFound(ctx) {
  const { s, base } = ctx;
  const body = `
<section class="section"><div class="wrap center nf">
  ${img('/img/art/generic.svg', '', 800, 600, { cls: 'nf-img' })}
  <h1>Page not found</h1>
  <p class="muted">Sorry, we could not find that page. The menu is always open.</p>
  <p class="hero-actions"><a class="btn" href="/">Go to home</a> <a class="btn btn-outline" href="/menu">View menu</a></p>
</div></section>`;
  return layout({
    s, base, path: '/404', body, noindex: true,
    title: `Page not found | ${s.restaurant_name}`,
    description: `This page could not be found on the ${s.restaurant_name} website.`,
  });
}

module.exports = { home, menu, about, contact, notFound, esc };
