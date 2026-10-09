-- TRD §14.4 (C-11, C-31, D-02): the NUC 5-point bands and GLIM's award classes, seeded as two
-- identical schemes that may diverge per programme. Pass mark 40; repeat policy BEST; good
-- standing CGPA >= 1.00 with no probation band. Existing programmes take the scheme of their
-- award type.
INSERT INTO "grading_schemes" ("name", "kind", "bands", "class_bands", "min_award_cgpa_x100", "max_points_x100", "pass_mark_x100", "repeat_policy", "good_standing_cgpa_x100")
SELECT name, 'NUC_5',
  '[{"minX100":7000,"maxX100":10000,"letter":"A","pointsX100":500,"pass":true},
    {"minX100":6000,"maxX100":6999,"letter":"B","pointsX100":400,"pass":true},
    {"minX100":5000,"maxX100":5999,"letter":"C","pointsX100":300,"pass":true},
    {"minX100":4500,"maxX100":4999,"letter":"D","pointsX100":200,"pass":true},
    {"minX100":4000,"maxX100":4499,"letter":"E","pointsX100":100,"pass":true},
    {"minX100":0,"maxX100":3999,"letter":"F","pointsX100":0,"pass":false}]'::jsonb,
  '[{"minCgpaX100":450,"maxCgpaX100":500,"label":"Distinction"},
    {"minCgpaX100":300,"maxCgpaX100":449,"label":"Credit"},
    {"minCgpaX100":100,"maxCgpaX100":299,"label":"Pass"}]'::jsonb,
  100, 500, 4000, 'BEST', 100
FROM (VALUES ('GLIM Certificate'), ('GLIM Diploma')) AS seed(name)
ON CONFLICT ("name") DO NOTHING;
--> statement-breakpoint
UPDATE "programmes" p SET "grading_scheme_id" = s."id"
FROM "grading_schemes" s
WHERE p."grading_scheme_id" IS NULL
  AND s."name" = CASE p."award_type" WHEN 'CERTIFICATE' THEN 'GLIM Certificate' ELSE 'GLIM Diploma' END;
