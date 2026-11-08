import { describe, it, expect } from "vitest";
import { categoryImage, foodImage } from "../src/lib/food-images";
import fs from "node:fs";

describe("local licensed photography", () => {
  it("maps every menu category to an existing local WebP", () => {
    for (const category of ["Starters", "Tandoori", "Main Course", "Breads", "Rice & Biryani", "Chinese", "Italian", "Continental", "Sandwiches", "Desserts", "Bakery", "Beverages", "Unknown"]) {
      const file = categoryImage(category);
      expect(file).toMatch(/^\/images\/.+\.webp$/);
      expect(fs.existsSync("public" + file)).toBe(true);
    }
  });

  it("matches featured dishes and falls back without hotlinks", () => {
    expect(foodImage("Chicken Biryani", "Indian")).toBe("/images/biryani.webp");
    expect(foodImage("Vegetable Pasta", "Italian")).toBe("/images/italian.webp");
    expect(foodImage("New dish", "Chinese")).toBe("/images/noodles.webp");
  });

  it("matches specific menu items to dish-accurate photography", () => {
    expect(foodImage("Paneer Tikka", "Starters (Veg.)")).toBe("/images/paneer-tikka.webp");
    expect(foodImage("Tandoori Chicken", "Starters (Non Veg.)")).toBe("/images/tandoori-chicken.webp");
    expect(foodImage("Dal Makhani", "Dal")).toBe("/images/dal-makhani.webp");
    expect(foodImage("Butter Chicken", "Main Course (Non Veg.)")).toBe("/images/butter-chicken.webp");
    expect(foodImage("Garlic Naan", "Bread")).toBe("/images/naan.webp");
    expect(foodImage("Butter Roti", "Bread")).toBe("/images/roti.webp");
    expect(foodImage("Veg Manchurian", "Chinese Starters (Veg.)")).toBe("/images/manchurian.webp");
    expect(foodImage("Veg Fried Rice", "Chinese Rice (Veg.)")).toBe("/images/fried-rice.webp");
    expect(foodImage("Veg Spring Roll", "Chinese Starters (Veg.)")).toBe("/images/spring-roll.webp");
    expect(foodImage("Chicken Lollypop", "Chinese Starters (Non Veg.)")).toBe("/images/chicken-lollipop.webp");
    expect(foodImage("Gulab Jamun", "Desserts")).toBe("/images/gulab-jamun.webp");
    expect(foodImage("Sizzling Brownie with Ice cream", "Desserts")).toBe("/images/brownie.webp");
    expect(foodImage("Malai / Matka Kulfi", "Desserts")).toBe("/images/kulfi.webp");
    expect(foodImage("Fresh Fruit Salad", "Desserts")).toBe("/images/fruit-salad.webp");
    expect(foodImage("Virgin Pina Colada", "Mocktails")).toBe("/images/mocktail.webp");
    expect(foodImage("Masala Papad", "Starters (Veg.)")).toBe("/images/papad.webp");
  });
});
