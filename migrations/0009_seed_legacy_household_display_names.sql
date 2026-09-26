-- Migration 0008 conservatively labelled every pre-identity setting as `user`,
-- including inherited/default values such as `Sudoku`. The authorized one-time
-- compatibility rule reclassifies that pre-0009 marker population as
-- seed-eligible. This necessarily also makes historic explicit names eligible
-- because no earlier edit-audit marker exists. The settings store consumes
-- `default` once using only the verified Access JWT principal; later PATCH
-- saves set `user` and are never re-seeded.
UPDATE household_settings
SET display_name_source = 'default'
WHERE display_name_source = 'user';
