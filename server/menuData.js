// Seed menu. Names are kept exactly as supplied by the restaurant. Prices are whole rupees.
// R(x)     -> single portion "Regular"
// SF(a,b)  -> "Single" / "Full"
// TBC      -> price to be confirmed (not orderable)
const R = (p) => [{ label: 'Regular', price: p }];
const SF = (a, b) => [{ label: 'Single', price: a }, { label: 'Full', price: b }];
const TBC = R(null);

module.exports = [
  {
    category: 'Soups',
    groups: [
      { sub: 'Veg', veg: true, items: [
        ['Veg Corn Soup', R(90)], ['Baby Corn Soup', R(110)], ['Veg Paneer Soup', R(120)],
        ['Veg Clear Soup', R(80)], ['Veg Manchurian Soup', R(120)], ['Hot Corn Soup', R(90)],
        ['Mushroom Soup', R(110)], ['American Choupsy Soup', R(120)], ['Tomato Soup', R(120)],
      ] },
      { sub: 'Non-veg', veg: false, items: [
        ['Chicken Soup', R(125)], ['Chicken Clear Soup', R(125)], ['Chicken Manchow Soup', R(125)],
        ['Chicken Pepper Soup', R(125)], ['Chicken Choupsy Soup', R(125)],
      ] },
    ],
  },
  {
    category: 'Kababs',
    groups: [
      { sub: 'Veg', veg: true, items: [
        ['Paneer Tikka', R(140)], ['Paneer Akkabari Tikka', R(160)],
        ['Paneer Malai Tikka', R(170)], ['Paneer Achari Tikka', R(160)],
      ] },
      { sub: 'Non-veg', veg: false, items: [
        ['Chicken Tikka (6 pieces)', R(150)], ['Chicken Leg-Piece Tikka (2 pieces)', R(130)],
        ['Chicken Tikka Akkabari (6 pieces)', R(170)], ['Chicken Ki Kachondi (2 pieces)', R(360)],
        ['Malai Tikka Chicken (6 pieces)', R(180)],
      ] },
    ],
  },
  {
    category: 'Starters',
    groups: [
      { sub: 'Veg', veg: true, items: [
        ['Veg Manchurian Dry / Wet', R(90)], ['Baby Corn Manchurian', R(110)], ['Mushroom Manchurian', R(140)],
        ['Paneer Manchurian', R(150)], ['Paneer 65', R(160)], ['Paneer Chilli Manchurian', R(160)],
        ['Paneer Garlic Manchurian', R(160)], ['Pepper Paneer', R(160)],
        ['Pepper Baby Corn Manchurian', TBC], ['Hong Kong Manchurian', R(170)],
      ] },
      { sub: 'Non-veg', veg: false, items: [
        ['Chicken Manchurian Dry / Wet', SF(150, 270)], ['Chicken 65', SF(170, 290)],
        ['Chicken Garlic', SF(170, 280)], ['Chicken Pepper', SF(170, 280)],
        ['Chilli Chicken', SF(170, 280)], ['Ginger Chicken', SF(170, 280)],
        ['Chicken Lollipop (4 pieces)', R(150)], ['Chicken Wings (8 pieces)', R(180)],
      ] },
    ],
  },
  {
    category: 'Noodles',
    groups: [
      { sub: 'Veg', veg: true, items: [
        ['Veg Noodles', SF(80, 140)], ['Veg Mushroom Noodles', SF(110, 170)], ['Veg Manchurian Noodles', SF(100, 160)],
        ['Veg Paneer Noodles', SF(140, 200)], ['Veg Garlic Noodles', SF(100, 160)], ['Veg Hakka Noodles', SF(110, 170)],
        ['Veg Chilli Noodles', SF(100, 140)], ['Veg Hong Kong Noodles', SF(130, 190)],
        ['Veg Singapore Noodles', SF(130, 190)], ['Veg Malaysian Noodles', SF(130, 190)],
      ] },
      { sub: 'Non-veg', veg: false, items: [
        ['Chicken Soft Noodles', SF(100, 170)], ['Chicken Manchurian Noodles', SF(150, 230)],
        ['Chicken Garlic Noodles', SF(140, 210)], ['Chicken Hakka Noodles', SF(150, 210)],
        ['Chicken Chilli Noodles', SF(150, 200)], ['Chicken Hong Kong Noodles', SF(150, 210)],
        ['Chicken Singapore Noodles', SF(150, 210)], ['Chicken Malaysia Noodles', SF(150, 210)],
        ['Double-Egg Chicken Noodles', SF(110, 190)], ['Egg Noodles', SF(90, 150)],
        ['Double Egg Noodles', SF(100, 160)], ['Chicken Szechaun Noodles', SF(170, 280)],
      ] },
    ],
  },
];
