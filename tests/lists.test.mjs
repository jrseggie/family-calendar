// 🛒 Lists (lib/lists.js): who may use them and what's checked on the way in
import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanList, cleanItem, sameItem, doneTwin, isFamilyLogin } from "../lib/lists.js";

const bad = (m) => { throw new Error(m); };
const people = [{ name: "Emma", family: 1 }, { name: "Nanny", family: 0 }];

test("only the family's own logins: admins and logins whose person is part of the family", () => {
  assert.equal(isFamilyLogin({ role: "admin", person: null }, people), true);
  assert.equal(isFamilyLogin({ role: "child", person: "Emma" }, people), true);
  assert.equal(isFamilyLogin({ role: "limited", person: "Nanny" }, people), false);
  assert.equal(isFamilyLogin({ role: "viewer", person: null }, people), false);
});

test("a list needs a name; its place is a house or 'other' with a name; members are numbers, once each", () => {
  const l = cleanList({ name: " Groceries ", place: "town", members: ["3", 3, "x", 5] }, bad, ["town", "farm"]);
  assert.deepEqual(l, { name: "Groceries", place: "town", place_name: null, members: [3, 5], important: 0 });
  assert.equal(cleanList({ name: "Hardware", place: "other", place_name: "Builders" }, bad, []).place_name, "Builders");
  assert.throws(() => cleanList({ name: "" }, bad, []), /name/);
  assert.throws(() => cleanList({ name: "A", place: "moon" }, bad, ["town"]), /place/);
  assert.throws(() => cleanList({ name: "A", place: "other" }, bad, []), /place/);
  assert.equal(cleanList({ name: "A" }, bad, []).place, null);
});

test("an item needs words; the phone's own id is kept only if it looks right; the same thing twice is spotted", () => {
  assert.deepEqual(cleanItem({ text: " milk ", note: "", client_id: "abcdEFGH1234" }, bad), { text: "milk", note: null, category: null, client_id: "abcdEFGH1234" });
  assert.equal(cleanItem({ text: "coffee", category: " Pantry " }, bad).category, "Pantry");
  assert.equal(cleanItem({ text: "bread", client_id: "x;drop" }, bad).client_id, null);
  assert.throws(() => cleanItem({ text: "  " }, bad), /list/);
  const items = [{ text: "Milk", done: 0 }, { text: "eggs", done: 1 }];
  assert.equal(sameItem(items, " milk ").text, "Milk");
  assert.equal(sameItem(items, "Eggs"), undefined);   // ticked already: adding it again is fine
});

test("adding something already completed brings that one back: capitals and extra spaces don't matter", () => {
  const items = [{ id: 1, text: "Hot Chocolate", done: 1 }, { id: 2, text: "Milk", done: 0 }];
  assert.equal(doneTwin(items, "HOT  chocolate ").id, 1);
  assert.equal(doneTwin(items, "milk"), undefined);   // still to get: that's a duplicate, not a comeback
  assert.equal(sameItem(items, "MILK").id, 2);
});
