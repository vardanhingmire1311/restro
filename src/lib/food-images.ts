// Food photographs for menu items. Source/license details: CREDITS.md.

export function categoryImage(category: string): string {
  const key = category.toLowerCase();
  if (/beverage|mocktail|drink/.test(key)) return "/images/drinks.webp";
  if (/bakery|cake/.test(key)) return "/images/dessert.webp";
  if (/dessert/.test(key)) return "/images/gulab-jamun.webp";
  if (/rice|biryani/.test(key)) return "/images/biryani.webp";
  if (/chinese|noodle/.test(key)) return "/images/noodles.webp";
  if (/italian|pizza/.test(key)) return "/images/italian.webp";
  if (/pasta/.test(key)) return "/images/pasta.webp";
  if (/sandwich/.test(key)) return "/images/sandwich.webp";
  if (/tandoori/.test(key)) return "/images/tandoori-chicken.webp";
  if (/starter/.test(key)) return "/images/paneer-tikka.webp";
  if (/bread/.test(key)) return "/images/naan.webp";
  if (/main course/.test(key)) return "/images/butter-chicken.webp";
  if (/continental/.test(key)) return "/images/pasta.webp";
  return "/images/indian.webp";
}

export function foodImage(name: string, category: string = "", section: string = ""): string {
  const n = name.toLowerCase();
  const c = category.toLowerCase();
  const s = section.toLowerCase();

  // 1. Soups (Check early so non-veg soups don't match chicken/mutton main course)
  if (/manchow|hot and sour|sweet\s*corn|wanton|talumein|egg drop|lung fung/i.test(n)) {
    return "/images/chinese-soup.webp";
  }
  if (/soup|shorba|crema|broth/i.test(n) || /soup/i.test(c)) {
    if (/chinese/i.test(s) || /chinese/i.test(c)) return "/images/chinese-soup.webp";
    return "/images/soup.webp";
  }

  // 2. Salads & Raitha
  if (/fruit salad|fruit custard/i.test(n)) return "/images/fruit-salad.webp";
  if (/raitha/i.test(n) || /raitha/i.test(c)) return "/images/raitha.webp";
  if (/salad/i.test(n) || /salad/i.test(c)) return "/images/salad.webp";

  // 3. Desserts & Bakery
  if (/gulab jamun/i.test(n)) return "/images/gulab-jamun.webp";
  if (/brownie|fudge/i.test(n)) return "/images/brownie.webp";
  if (/kulfi/i.test(n)) return "/images/kulfi.webp";
  if (/ice cream|sundae|sunday/i.test(n)) return "/images/ice-cream.webp";
  if (/fruit salad|fruit custard/i.test(n)) return "/images/fruit-salad.webp";
  if (/cake|pastr|almond|walnut/i.test(n) || /bakery/i.test(s) || /bakery/i.test(c)) return "/images/dessert.webp";
  if (/dessert/i.test(s) || /dessert/i.test(c)) return "/images/ice-cream.webp";

  // 4. Beverages & Mocktails
  if (/mojito/i.test(n)) return "/images/drinks.webp";
  if (/mocktail|colada|punch|cooler|blossom|granite|iced? tea|spice|angel|sweet princess|lady|delight|mary/i.test(n) || /mocktail|beverage/i.test(s) || /mocktail|beverage/i.test(c)) {
    return "/images/mocktail.webp";
  }

  // 5. Sandwiches & Burgers
  if (/sandwich|bread butter/i.test(n) || /sandwich/i.test(s) || /sandwich/i.test(c)) return "/images/sandwich.webp";

  // 6. Noodles & Chowmein
  if (/noodle|chowmein|chopsuey/i.test(n) || /noodle/i.test(c)) return "/images/noodles.webp";

  // 7. Rice & Biryani
  if (/biryani/i.test(n)) return "/images/biryani.webp";
  if (/fried rice|sez fried rice|schezwan.*rice|combination.*rice|triple.*schezwan.*rice|tripple.*schezwan.*rice|stewed rice/i.test(n)) {
    return "/images/fried-rice.webp";
  }
  if (/pulav|pulao|jeera rice|steamed rice|khichadi|curd rice/i.test(n)) return "/images/fried-rice.webp";

  // 8. Italian & Continental Pastas & Bakes
  if (/lasagne|casarole|ferdinad|canaloni/i.test(n)) return "/images/lasagne.webp";
  if (/bruchetta/i.test(n)) return "/images/bruschetta.webp";
  if (/pizza/i.test(n)) return "/images/italian.webp";
  if (/pasta|spaghetti|macroni|penne|farfale|fettucini|fussili/i.test(n) || /pasta/i.test(c)) {
    if (n === "vegetable pasta") return "/images/italian.webp";
    return "/images/pasta.webp";
  }

  // 9. Breads
  if (/naan|kulcha/i.test(n)) return "/images/naan.webp";
  if (/roti|paratha/i.test(n) || /bread/i.test(c) || /bread/i.test(s)) return "/images/roti.webp";

  // 10. Starters & Dry Appetizers
  if (/spring roll/i.test(n)) return "/images/spring-roll.webp";
  if (/manchurian/i.test(n)) return "/images/manchurian.webp";
  if (/chicken lollypop/i.test(n)) return "/images/chicken-lollipop.webp";
  if (/chilli|chilly|crispy veg|babycorn/i.test(n)) return "/images/chilli-paneer.webp";
  if (/paneer.*(?:tikka|kabab|malai|achari)|assorted veg tikka/i.test(n)) return "/images/paneer-tikka.webp";
  if (/tandoori chicken|tangdi kabab/i.test(n)) return "/images/tandoori-chicken.webp";
  if (/sheekh? kabab|reshami kabab|harabhara kabab|jafrani kabab|buransi kabab|murgh kabab|satay/i.test(n)) return "/images/kebab.webp";
  if (/papad/i.test(n)) return "/images/papad.webp";
  if (/fish|prawn|pomfret|croquette|fingers|nuggets/i.test(n)) return "/images/fish-tikka.webp";
  if (/tandoori gobi|tandoori aloo|tandoori mushroom|paneer pakoda|fried cashewnut|tikki|stuffed mushroom/i.test(n)) {
    return "/images/paneer-tikka.webp";
  }

  // 11. Main Course Gravies & Curries
  if (/dal|makhani/i.test(n) || /dal/i.test(c)) return "/images/dal-makhani.webp";
  if (/butter chicken|murgh mussallum|chicken tikka masala|chicken nawabi/i.test(n)) return "/images/butter-chicken.webp";
  if (/choice of paneer|paneer bhurji|paneer noorani|panner rajwada|paneer in hot garlic|paneer/i.test(n)) {
    return "/images/paneer-curry.webp";
  }
  if (/mutton|kheema/i.test(n)) return "/images/mutton-curry.webp";
  if (/chicken|poulet/i.test(n)) return "/images/butter-chicken.webp";
  if (/egg/i.test(n)) return "/images/veg-curry.webp";
  if (/choice of veg|chole|rajma|malai kofta|dum aloo|aloo gobi|bhindi|navaratna|methi mutter|subzi|shyam savera|mushroom sundri/i.test(n)) {
    return "/images/veg-curry.webp";
  }

  // Fallback to categoryImage
  return categoryImage(category);
}
