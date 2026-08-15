import { test } from "node:test";
import assert from "node:assert/strict";
import { detectShape, nameKey, parseCsv, placeIdFrom, splitAddress, toRows } from "../src/db/csv-rows.js";

const MAPS_A = `"Find local businesses on Google Maps","Name","Google Maps URL","Description","Website","Phone","Address","Rating","Reviews Count"
,"Skyn by Sara","https://www.google.com/maps/place/?q=place_id:ChIJGf752DmLYIgRppXX0f9oVck",,"https://skynbysaraatbeicapelli.com/","+1 423-834-5104","6204 Hixson Pike, Hixson, TN 37343, USA",5,10`;

// Same export tool, columns swapped — this is why mapping is by header name.
const MAPS_B = `"Find local businesses on Google Maps","Name","Google Maps URL","Description","Website","Phone","Address","Reviews Count","Rating"
,"Skyn by Sara","https://www.google.com/maps/place/?q=place_id:ChIJGf752DmLYIgRppXX0f9oVck",,"https://skynbysaraatbeicapelli.com/","+1 423-834-5104","6204 Hixson Pike, Hixson, TN 37343, USA",10,5`;

const EMAILS = `email,company,email_verified,source_file
Info@orchidiamedicalgroup.com,Orchidia Medical Group,no,contacts.csv`;

test("detects both CSV shapes", () => {
  assert.equal(detectShape(Object.keys(parseCsv(MAPS_A)[0]!)), "google-maps");
  assert.equal(detectShape(Object.keys(parseCsv(EMAILS)[0]!)), "emails");
  assert.equal(detectShape(["foo", "bar"]), "unknown");
});

test("swapped Rating / Reviews Count columns still map correctly", () => {
  const a = toRows(parseCsv(MAPS_A), "a.csv")[0]!;
  const b = toRows(parseCsv(MAPS_B), "b.csv")[0]!;
  assert.equal(a.rating, 5);
  assert.equal(a.reviewCount, 10);
  assert.deepEqual([b.rating, b.reviewCount], [a.rating, a.reviewCount]);
});

test("pulls place_id out of the Maps URL", () => {
  assert.equal(
    placeIdFrom("https://www.google.com/maps/place/?q=place_id:ChIJGf752DmLYIgRppXX0f9oVck"),
    "ChIJGf752DmLYIgRppXX0f9oVck",
  );
  assert.equal(placeIdFrom("https://example.com"), null);
});

test("derives domain and city from a Maps row", () => {
  const row = toRows(parseCsv(MAPS_A), "a.csv")[0]!;
  assert.equal(row.domain, "skynbysaraatbeicapelli.com");
  assert.equal(row.city, "Hixson");
  assert.equal(row.region, "TN");
});

test("address parsing declines to guess when the shape is unfamiliar", () => {
  assert.deepEqual(splitAddress("Dubai"), { city: null, region: null });
  assert.deepEqual(splitAddress("Some St, Dubai, UAE"), { city: null, region: null });
});

test("name key survives legal suffixes and punctuation, so the files join", () => {
  assert.equal(nameKey("Orchidia Medical Group, LLC"), nameKey("Orchidia Medical Group"));
  assert.equal(nameKey("Smith & Sons Inc."), "smith and sons");
});

test("email rows normalise the address and carry the verified flag", () => {
  const row = toRows(parseCsv(EMAILS), "us-emails.csv")[0]!;
  assert.equal(row.email, "info@orchidiamedicalgroup.com");
  assert.equal(row.emailVerified, false);
  assert.equal(row.name, "Orchidia Medical Group");
  assert.equal(row.website, null);
});
