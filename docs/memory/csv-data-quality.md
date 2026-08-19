---
name: csv-data-quality
description: The enrichment data is wrong about 15-20% of the time - the specific junk patterns to blocklist before any send
metadata: 
  node_type: memory
  type: gotcha
  originSessionId: e8c7f055-1255-4ac6-865a-49978db3f039
  modified: 2026-08-19T17:01:49.065Z
---

Harvested prospect data (both the Neon `prospects` table and the prospector CSV exports) is unreliable at roughly a **15-20% rate**. Measured across 406 rows on 2026-08-19. Always verify before trusting a row.

**Junk email patterns actually seen - worth a blocklist regex:**

- **Anti-scraping decoys**: the literal string `[email protected]`, which is what many sites render to defeat scrapers. Resend rejects these with a 422 validation error.
- **Scraped image filenames**: `px_contact-secbg@1.2x.avif`
- **Template placeholders**: `first.last@company.com`, `email@address.com`, `jane@mail.com`
- **Social handles as addresses**: `jonathan@instagram.com`, `lauren@instagram.com` - these businesses have no website, only an Instagram page
- **Vendor and platform inboxes**: `customercare@99calls.com` (lead-gen), `webservices@chrisad.com` (dental marketing), `sales@vagaro.com` and glossgenius (booking platforms), `dave@lab6.com` and `micah@micahrich.com` (the business's web developer), `privacy.policy@rotorooter.com` (franchise legal), `jobs@cremedesign.com` (careers)
- **URL-encoded junk**: `%20frontdesk@...`, and a phone number fused to an address (`239-776-4956dlux@dluxmedspa.com`)

**Do not over-block.** A `sales@` or `jobs@` on the business's **own domain** is a real inbox at the real company - only a poor door. The useful test is whether the email domain matches the website domain; a third-party domain is the actual signal.

**Other fields are wrong too:**
- Wrong city (Born Again Doctor listed The Villages, site says Ocala; Gagliano Law listed New York, is Aventura FL), and one row's city was literally `BOWLING GREEN, NY` - a subway stop.
- Wrong vertical (a plumbing *supply store* listed as a plumbing contractor; a hair extension studio listed as a med spa).
- `first_name` containing a surname ("Walter" for Dr. Leora Walter), a bare initial ("H", "A"), or the literal title "Dr.".
- 126 of 406 rows had no first name at all; only ~17% of those could be recovered by reading the site, because small landscapers, booking-platform med spas and template CPA sites name nobody.

**How to apply:** run the blocklist before any batch send, and prefer a verification API (NeverBounce/ZeroBounce, cents per check) over trusting the file - the 2026-08-19 run of 260 went out entirely unverified. See [[email-recovery-fallbacks]] and [[csv-outreach-run]].
