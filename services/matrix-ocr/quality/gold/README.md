# OCR gold dataset boundary

`synthetic-v1/manifest.json` is a versioned, generated regression fixture. It contains no client document,
personal data, case fact, or copied judicial instrument. It may prove metric and pipeline repeatability only;
it is never a production-quality claim.

A production candidate dataset must use a separate version, documented source rights and de-identification,
two independent annotations plus adjudication, locked train/tune/test splits, and checksums for every source and
annotation. It must cover contracts, pleadings, evidence lists, invoices, tables, formulas, seals, handwriting,
skew, rotation, scans, and multi-page PDF pagination. No production threshold may be lowered to make a model pass.

