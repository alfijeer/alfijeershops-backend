'use strict';
// SINGLE SOURCE OF TRUTH for categories. These are exactly the options sellers pick at registration and in the seller
// dashboard. Add new words to KEYWORDS any time (no other code changes): they teach search which shops sell what.
const CATEGORIES = [
  ['Food, Grains & Spices', '🌾'], ['Beauty & Personal Care', '💄'], ['Household & Cleaning Supplies', '🧴'],
  ['Health & Wellness', '💊'], ['Fashion & Clothing', '👕'], ['Baby & Kids', '🧸'], ['Phones & Electronics', '📱'],
  ['Farm Products', '🫘'], ['Home & Furniture', '🛋️'], ['Building Materials & Hardware', '🧱'],
  ['Vehicles & Spare Parts', '🚗'], ['Business & Industrial Equipment', '⚙️'],
  ['Books, Office & School Supplies', '📚'], ['Sports & Outdoor', '⚽'], ['Other', '📦']
].map(([name, icon]) => ({ name, icon }));

// word -> category. A buyer typing "samsung" is shown shops in Phones & Electronics even if no product says "phone".
const KEYWORDS = {
  'Phones & Electronics': 'phone phones smartphone samsung galaxy iphone apple tecno infinix itel xiaomi redmi oppo vivo realme nokia huawei android charger earphone earphones earpiece headphone headphones powerbank laptop laptops computer tablet ipad tv television speaker camera airpod smartwatch router generator fan fridge freezer decoder hp dell lenovo macbook',
  'Fashion & Clothing': 'shoe shoes sneaker sneakers sandal sandals slippers abaya hijab dress gown ankara lace shirt trouser trousers jeans cap bag handbag jalabiya kaftan babanriga fabric material wrapper scarf socks wear cloth clothes clothing',
  'Food, Grains & Spices': 'rice beans garri flour maize millet sorghum spice spices pepper oil tomato sugar salt noodles indomie milk tea groundnut yam onion dates honey grain grains food',
  'Beauty & Personal Care': 'cream lotion perfume spray soap makeup lipstick wig hair attar oud shampoo nail skincare razor cosmetics beauty',
  'Household & Cleaning Supplies': 'detergent omo bleach broom mop bucket plate pot cup kettle tissue toothpaste cleaning kitchen utensils',
  'Health & Wellness': 'drug drugs medicine pharmacy vitamin vitamins supplement herbal thermometer mask sanitizer health',
  'Baby & Kids': 'diaper diapers pampers baby toy toys stroller kids children',
  'Farm Products': 'fertilizer seed seeds goat sheep cow chicken poultry feed vegetable vegetables fruit fruits livestock farm',
  'Home & Furniture': 'sofa chair table bed mattress curtain curtains carpet rug wardrobe furniture cabinet',
  'Building Materials & Hardware': 'cement paint tile tiles roofing zinc pipe pipes wire cable door plywood hardware tools drill building',
  'Vehicles & Spare Parts': 'car cars motorcycle bike tyre tyres tire tires battery engine spare parts brake mechanic vehicle',
  'Business & Industrial Equipment': 'machine machines printer pos grinder industrial equipment',
  'Books, Office & School Supplies': 'book books pen pens notebook paper stationery uniform school textbook quran office',
  'Sports & Outdoor': 'football jersey gym bicycle camping sport sports outdoor'
};

// Specific names (not product types). A brand word must appear in the product itself; it never matches a whole category.
const BRANDS = new Set('samsung galaxy iphone apple tecno infinix itel xiaomi redmi oppo vivo realme nokia huawei hp dell lenovo macbook omo indomie pampers'.split(' '));

const STOPWORDS = new Set('the for and of in at to with buy sell selling shop shops store near me my cheap best price prices any some i want need looking available'.split(' '));

module.exports = { CATEGORIES, KEYWORDS, STOPWORDS, BRANDS };
