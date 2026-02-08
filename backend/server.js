import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import pkg from "pg";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import crypto from "crypto";

dotenv.config();
const { Pool } = pkg;

/** ---------------- Config ---------------- */
const PORT = Number(process.env.PORT || 3001);
const JWT_SECRET = process.env.JWT_SECRET || "CHANGE_ME_SUPER_SECRET";
const TOKEN_EXPIRES_IN = process.env.TOKEN_EXPIRES_IN || "7d";
const SPEED_KMH_DEFAULT = Number(process.env.SPEED_KMH || 40);

const pool = new Pool({
  host: process.env.DB_HOST || "localhost",
  port: Number(process.env.DB_PORT || 5432),
  database: process.env.DB_NAME || "new",
  user: process.env.DB_USER || "postgres",
  password: process.env.DB_PASS || "admin",
});

/** ---------------- App ---------------- */
const app = express();

app.use(
  cors({
    origin: "*", // لاحقًا: قفله على دومين الفرونت
    credentials: false,
  })
);

app.use(express.json({ limit: "2mb" }));

/** ---------------- Helpers ---------------- */
const nowISO = () => new Date().toISOString();

function safeNum(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

function ok(res, data = null) {
  return res.json({ ok: true, data });
}

function fail(res, status, message, code = "ERROR") {
  return res.status(status).json({ ok: false, error: { code, message } });
}

function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

function signToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: TOKEN_EXPIRES_IN });
}

function normalizeEmail(email) {
  return String(email || "").toLowerCase().trim();
}

/** ---------------- Auth middleware ---------------- */
function authRequired(req, res, next) {
  const h = req.headers.authorization || "";
  const m = h.match(/^Bearer\s+(.+)$/i);
  if (!m) return fail(res, 401, "Missing Bearer token", "AUTH_MISSING_TOKEN");

  try {
    req.user = jwt.verify(m[1], JWT_SECRET);
    return next();
  } catch {
    return fail(res, 401, "Invalid/expired token", "AUTH_INVALID_TOKEN");
  }
}

function roleRequired(role) {
  return (req, res, next) => {
    if (!req.user?.role) return fail(res, 401, "Unauthorized", "AUTH_UNAUTHORIZED");
    if (req.user.role !== role) return fail(res, 403, "Forbidden", "AUTH_FORBIDDEN");
    return next();
  };
}

/** ---------------- DB schema detection ---------------- */
async function detectWaysIdColumn() {
  const sql = `
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema='public' AND table_name='ways'
      AND column_name IN ('gid','id','osm_id','the_id')
    ORDER BY CASE column_name
      WHEN 'gid' THEN 1
      WHEN 'id' THEN 2
      WHEN 'osm_id' THEN 3
      WHEN 'the_id' THEN 4
      ELSE 99 END
    LIMIT 1;
  `;
  const { rows } = await pool.query(sql);
  return rows[0]?.column_name || "gid";
}

async function detectRouteGeojsonIsJsonb() {
  const sql = `
    SELECT data_type, udt_name
    FROM information_schema.columns
    WHERE table_schema='public'
      AND table_name='student_choices'
      AND column_name='route_geojson'
    LIMIT 1;
  `;
  const { rows } = await pool.query(sql);
  const t = rows[0]?.udt_name || rows[0]?.data_type || "";
  return t.includes("json");
}

let WAYS_ID_COL = "gid";
let ROUTE_GEOJSON_IS_JSON = true;

/** ---------------- Geo helpers ---------------- */
async function buildFeatureCollectionFromTable(tableName, geomCol = "geom", limit = 5000) {
  const hardLimit = Math.max(1, Math.min(Number(limit) || 5000, 100000));

  const sql = `
    SELECT jsonb_build_object(
      'type','FeatureCollection',
      'features', COALESCE(jsonb_agg(
        jsonb_build_object(
          'type','Feature',
          'geometry', ST_AsGeoJSON(t.${geomCol})::jsonb,
          'properties', (to_jsonb(t) - '${geomCol}')
        )
      ), '[]'::jsonb)
    ) AS fc
    FROM (
      SELECT *
      FROM public.${tableName}
      WHERE ${geomCol} IS NOT NULL
      LIMIT $1
    ) t;
  `;
  const { rows } = await pool.query(sql, [hardLimit]);
  return rows[0]?.fc || { type: "FeatureCollection", features: [] };
}

async function computeRoute({ hubId, collegeId, speedKmh }) {
  const speed = Number.isFinite(speedKmh) ? speedKmh : SPEED_KMH_DEFAULT;

  const sql = `
    WITH
    s AS (SELECT geom FROM public.bus_hubs WHERE id = $1),
    g AS (SELECT geom FROM public.data WHERE id = $2),

    start_vid AS (
      SELECT id AS vid
      FROM public.ways_vertices_pgr, s
      ORDER BY public.ways_vertices_pgr.the_geom <-> s.geom
      LIMIT 1
    ),
    goal_vid AS (
      SELECT id AS vid
      FROM public.ways_vertices_pgr, g
      ORDER BY public.ways_vertices_pgr.the_geom <-> g.geom
      LIMIT 1
    ),

    route AS (
      SELECT * FROM pgr_dijkstra(
        $$SELECT ${WAYS_ID_COL}::integer AS id,
                 source, target,
                 ST_Length(ST_Transform(the_geom, 3857))::float8 AS cost,
                 ST_Length(ST_Transform(the_geom, 3857))::float8 AS reverse_cost
          FROM public.ways
          WHERE the_geom IS NOT NULL AND source IS NOT NULL AND target IS NOT NULL$$,
        (SELECT vid FROM start_vid),
        (SELECT vid FROM goal_vid),
        directed := false
      )
    ),

    edges AS (
      SELECT
        ${WAYS_ID_COL}::integer AS eid,
        the_geom AS geom,
        ST_Length(ST_Transform(the_geom, 3857))::float8 AS len_m
      FROM public.ways
      WHERE the_geom IS NOT NULL
    )

    SELECT
      ST_AsGeoJSON(ST_LineMerge(ST_Union(e.geom))) AS route_geojson,
      SUM(e.len_m) AS distance_m
    FROM route r
    JOIN edges e ON r.edge = e.eid
    WHERE r.edge <> -1;
  `;

  const { rows } = await pool.query(sql, [hubId, collegeId]);
  if (!rows.length || !rows[0].route_geojson || rows[0].distance_m == null) return null;

  const distance_m = Number(rows[0].distance_m);
  const time_s = (distance_m / 1000 / speed) * 3600;
  const time_min = time_s / 60;

  return {
    route_geojson: JSON.parse(rows[0].route_geojson),
    distance_m,
    time_s,
    time_min,
    speed_kmh: speed,
  };
}

/** ---------------- HEALTH ---------------- */
app.get(
  "/health",
  asyncHandler(async (req, res) => {
    const r = await pool.query("SELECT 1 AS ok");
    return ok(res, { db: r.rows[0].ok === 1, ts: nowISO() });
  })
);

/** ---------------- GEOJSON (frontend map) ---------------- */
app.get(
  "/api/wfs/data",
  asyncHandler(async (req, res) => {
    const limit = Number(req.query.limit || 5000);
    const fc = await buildFeatureCollectionFromTable("data", "geom", limit);
    return ok(res, fc);
  })
);

app.get(
  "/api/wfs/bus_hubs",
  asyncHandler(async (req, res) => {
    const limit = Number(req.query.limit || 5000);
    const fc = await buildFeatureCollectionFromTable("bus_hubs", "geom", limit);
    return ok(res, fc);
  })
);

/** ---------------- LISTS ---------------- */
app.get(
  "/api/colleges/list",
  asyncHandler(async (req, res) => {
    const sql = `
      SELECT id, name, type, governorate, min_score_required, fees, education_period, capacity, access_url
      FROM public.data
      ORDER BY name ASC;
    `;
    const { rows } = await pool.query(sql);
    return ok(res, rows);
  })
);

app.get(
  "/api/bus_hubs/list",
  asyncHandler(async (req, res) => {
    const { rows } = await pool.query(`SELECT id, name FROM public.bus_hubs ORDER BY name ASC;`);
    return ok(res, rows);
  })
);

/** ---------------- NEAREST HUB ---------------- */
app.get(
  "/api/hubs/nearest",
  asyncHandler(async (req, res) => {
    const collegeId = Number(req.query.college_id);
    if (!collegeId) return fail(res, 400, "college_id is required", "VALIDATION");

    const sql = `
      WITH c AS (SELECT geom FROM public.data WHERE id = $1)
      SELECT b.id AS hub_id, b.name AS hub_name, ST_DistanceSphere(b.geom, c.geom) AS dist_m
      FROM public.bus_hubs b, c
      WHERE b.geom IS NOT NULL AND c.geom IS NOT NULL
      ORDER BY b.geom <-> c.geom
      LIMIT 1;
    `;
    const { rows } = await pool.query(sql, [collegeId]);
    if (!rows.length) return fail(res, 404, "No hub found", "NOT_FOUND");

    return ok(res, {
      hub_id: rows[0].hub_id,
      hub_name: rows[0].hub_name,
      dist_m: safeNum(rows[0].dist_m),
    });
  })
);

/** ---------------- ROUTING ---------------- */
app.get(
  "/api/routing",
  asyncHandler(async (req, res) => {
    const hubId = Number(req.query.hub_id);
    const collegeId = Number(req.query.college_id);
    const speedKmh = safeNum(req.query.speed_kmh) ?? SPEED_KMH_DEFAULT;

    if (!hubId || !collegeId) return fail(res, 400, "hub_id and college_id are required", "VALIDATION");

    const r = await computeRoute({ hubId, collegeId, speedKmh });
    if (!r) return fail(res, 404, "No route found", "NOT_FOUND");
    return ok(res, r);
  })
);

/** ---------------- AUTH ---------------- */
app.post(
  "/api/auth/register",
  asyncHandler(async (req, res) => {
    const {
      email,
      password,
      role,
      full_name,
      phone,
      governorate,
      high_school_score,
      high_school_year,
      avatar_url,
    } = req.body || {};

    if (!email || !password || !role || !full_name) {
      return fail(res, 400, "email, password, role, full_name are required", "VALIDATION");
    }
    if (!["student", "admin"].includes(role)) return fail(res, 400, "role must be student or admin", "VALIDATION");

    const emailNorm = normalizeEmail(email);
    const hash = await bcrypt.hash(String(password), 10);

    const sql = `
      INSERT INTO public.users
        (email, password_hash, role, full_name, phone, governorate, high_school_score, high_school_year, avatar_url, is_active, created_at, updated_at)
      VALUES
        ($1,$2,$3,$4,$5,$6,$7,$8,$9,TRUE,NOW(),NOW())
      RETURNING id, email, role, full_name, phone, governorate, high_school_score, high_school_year, avatar_url, is_active, created_at, updated_at;
    `;

    try {
      const { rows } = await pool.query(sql, [
        emailNorm,
        hash,
        role,
        String(full_name).trim(),
        String(phone || "").trim(),
        String(governorate || "").trim(),
        safeNum(high_school_score),
        high_school_year != null ? Number(high_school_year) : null,
        String(avatar_url || "").trim(),
      ]);

      return ok(res, { user: rows[0] });
    } catch (e) {
      // Postgres unique violation code = 23505
      if (e?.code === "23505") return fail(res, 409, "Email already exists", "CONFLICT");
      throw e;
    }
  })
);

app.post(
  "/api/auth/login",
  asyncHandler(async (req, res) => {
    const { email, password } = req.body || {};
    if (!email || !password) return fail(res, 400, "email and password are required", "VALIDATION");

    const sql = `
      SELECT id, email, password_hash, role, full_name, is_active
      FROM public.users
      WHERE email = $1
      LIMIT 1;
    `;
    const { rows } = await pool.query(sql, [normalizeEmail(email)]);
    if (!rows.length) return fail(res, 401, "Invalid credentials", "AUTH_INVALID");
    if (rows[0].is_active === false) return fail(res, 403, "Account disabled", "AUTH_DISABLED");

    const okPass = await bcrypt.compare(String(password), rows[0].password_hash);
    if (!okPass) return fail(res, 401, "Invalid credentials", "AUTH_INVALID");

    const token = signToken({ id: String(rows[0].id), role: rows[0].role, email: rows[0].email });

    return ok(res, {
      token,
      user: { id: rows[0].id, email: rows[0].email, role: rows[0].role, full_name: rows[0].full_name },
    });
  })
);

/**
 * Forgot password:
 * - stores code in password_resets (recommended)
 * - also returns reset_token for compatibility (demo)
 */
app.post(
  "/api/auth/forgot",
  asyncHandler(async (req, res) => {
    const { email } = req.body || {};
    if (!email) return fail(res, 400, "email is required", "VALIDATION");

    const emailNorm = normalizeEmail(email);

    const u = await pool.query(`SELECT id, email FROM public.users WHERE email = $1 LIMIT 1;`, [emailNorm]);
    if (!u.rows.length) return ok(res, {}); // security: still ok

    // generate 6-digit code
    const code = String(Math.floor(100000 + Math.random() * 900000));

    // expires in 30 minutes
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000);

    await pool.query(
      `
      INSERT INTO public.password_resets (email, code, expires_at, used, created_at)
      VALUES ($1, $2, $3, FALSE, NOW());
      `,
      [emailNorm, code, expiresAt]
    );

    // legacy token (optional)
    const reset_token = jwt.sign({ type: "reset", email: emailNorm }, JWT_SECRET, { expiresIn: "30m" });

    // NOTE: in production send code via email, do NOT return it.
    return ok(res, { reset_token, code });
  })
);

/**
 * Reset password:
 * supports:
 * 1) reset_token + new_password
 * 2) email + code + new_password  (preferred based on your schema)
 */
app.post(
  "/api/auth/reset",
  asyncHandler(async (req, res) => {
    const { reset_token, email, code, new_password } = req.body || {};
    if (!new_password) return fail(res, 400, "new_password is required", "VALIDATION");

    // (2) email+code flow
    if (email && code) {
      const emailNorm = normalizeEmail(email);

      const r = await pool.query(
        `
        SELECT id, email, code, expires_at, used
        FROM public.password_resets
        WHERE email = $1 AND code = $2
        ORDER BY created_at DESC
        LIMIT 1;
        `,
        [emailNorm, String(code)]
      );

      if (!r.rows.length) return fail(res, 400, "Invalid reset code", "AUTH_INVALID");
      if (r.rows[0].used) return fail(res, 400, "Reset code already used", "AUTH_INVALID");
      if (new Date(r.rows[0].expires_at).getTime() < Date.now()) return fail(res, 400, "Reset code expired", "AUTH_INVALID");

      const hash = await bcrypt.hash(String(new_password), 10);

      const upd = await pool.query(
        `
        UPDATE public.users
        SET password_hash = $1, updated_at = NOW()
        WHERE email = $2
        RETURNING id, email, role, full_name;
        `,
        [hash, emailNorm]
      );

      await pool.query(`UPDATE public.password_resets SET used = TRUE WHERE id = $1;`, [r.rows[0].id]);

      return ok(res, { user: upd.rows[0] });
    }

    // (1) token flow
    if (!reset_token) return fail(res, 400, "reset_token OR (email+code) is required", "VALIDATION");

    let payload;
    try {
      payload = jwt.verify(String(reset_token), JWT_SECRET);
    } catch {
      return fail(res, 400, "Invalid/expired reset token", "AUTH_INVALID");
    }
    if (payload.type !== "reset") return fail(res, 400, "Invalid reset token type", "AUTH_INVALID");

    const hash = await bcrypt.hash(String(new_password), 10);

    const upd = await pool.query(
      `
      UPDATE public.users
      SET password_hash = $1, updated_at = NOW()
      WHERE email = $2
      RETURNING id, email, role, full_name;
      `,
      [hash, normalizeEmail(payload.email)]
    );

    return ok(res, { user: upd.rows[0] });
  })
);

app.get(
  "/api/me",
  authRequired,
  asyncHandler(async (req, res) => {
    const sql = `
      SELECT id, email, role, full_name, phone, governorate, high_school_score, high_school_year, avatar_url, is_active, created_at, updated_at
      FROM public.users
      WHERE id = $1
      LIMIT 1;
    `;
    const { rows } = await pool.query(sql, [Number(req.user.id)]);
    return ok(res, { user: rows[0] });
  })
);

/** ---------------- CHOICES ---------------- */
function normalizeChoiceSource(x, fallback = "manual") {
  const v = String(x || "").toLowerCase().trim();
  if (v === "manual" || v === "auto") return v;
  return fallback;
}

app.post(
  "/api/choices",
  authRequired,
  asyncHandler(async (req, res) => {
    if (req.user.role !== "student") return fail(res, 403, "Only students can save choices", "FORBIDDEN");

    const studentId = Number(req.user.id);
    const college_id = Number(req.body?.college_id);
    let hub_id = req.body?.hub_id != null ? Number(req.body.hub_id) : null;
    let choice_source = normalizeChoiceSource(req.body?.choice_source, "manual");
    const notes = String(req.body?.notes || "");

    if (!college_id) return fail(res, 400, "college_id is required", "VALIDATION");

    if (!hub_id) {
      const near = await pool.query(
        `
        WITH c AS (SELECT geom FROM public.data WHERE id = $1)
        SELECT b.id AS hub_id
        FROM public.bus_hubs b, c
        ORDER BY b.geom <-> c.geom
        LIMIT 1;`,
        [college_id]
      );
      hub_id = near.rows[0]?.hub_id || null;
      choice_source = "auto";
    }

    if (!hub_id) return fail(res, 400, "hub_id could not be resolved", "VALIDATION");

    const route = await computeRoute({ hubId: hub_id, collegeId: college_id, speedKmh: SPEED_KMH_DEFAULT });
    if (!route) return fail(res, 404, "No route found for this hub/college", "NOT_FOUND");

    const geoStr = JSON.stringify(route.route_geojson);

    const insertSql = ROUTE_GEOJSON_IS_JSON
      ? `
        INSERT INTO public.student_choices
          (student_id, college_id, hub_id, chosen_at, route_distance_m, route_time_s, route_geojson, status, choice_source, notes, updated_at)
        VALUES
          ($1,$2,$3,NOW(),$4,$5,$6::jsonb,'saved',$7,$8,NOW())
        RETURNING *;
      `
      : `
        INSERT INTO public.student_choices
          (student_id, college_id, hub_id, chosen_at, route_distance_m, route_time_s, route_geojson, status, choice_source, notes, updated_at)
        VALUES
          ($1,$2,$3,NOW(),$4,$5,$6,'saved',$7,$8,NOW())
        RETURNING *;
      `;

    const { rows } = await pool.query(insertSql, [
      studentId,
      college_id,
      hub_id,
      route.distance_m,
      route.time_s,
      geoStr,
      choice_source,
      notes,
    ]);

    return ok(res, { choice: rows[0] });
  })
);

app.get(
  "/api/choices/mine",
  authRequired,
  asyncHandler(async (req, res) => {
    if (req.user.role !== "student") return fail(res, 403, "Only students", "FORBIDDEN");

    const sql = `
      SELECT sc.*,
             d.name AS college_name,
             b.name AS hub_name
      FROM public.student_choices sc
      LEFT JOIN public.data d ON d.id = sc.college_id
      LEFT JOIN public.bus_hubs b ON b.id = sc.hub_id
      WHERE sc.student_id = $1
      ORDER BY sc.chosen_at DESC
      LIMIT 200;
    `;
    const { rows } = await pool.query(sql, [Number(req.user.id)]);
    return ok(res, { items: rows });
  })
);

app.get(
  "/api/admin/choices",
  authRequired,
  roleRequired("admin"),
  asyncHandler(async (req, res) => {
    const sql = `
      SELECT sc.*,
             u.full_name AS student_name, u.email AS student_email,
             d.name AS college_name,
             b.name AS hub_name
      FROM public.student_choices sc
      LEFT JOIN public.users u ON u.id = sc.student_id
      LEFT JOIN public.data d ON d.id = sc.college_id
      LEFT JOIN public.bus_hubs b ON b.id = sc.hub_id
      ORDER BY sc.chosen_at DESC
      LIMIT 500;
    `;
    const { rows } = await pool.query(sql);
    return ok(res, { items: rows });
  })
);

/** ---------------- ADMIN ADD COLLEGE/HUB (optional) ---------------- */
app.post(
  "/api/admin/colleges",
  authRequired,
  roleRequired("admin"),
  asyncHandler(async (req, res) => {
    const { name, type, governorate, min_score_required, fees, education_period, capacity, lat, lng } = req.body || {};
    if (!name || lat == null || lng == null) return fail(res, 400, "name, lat, lng required", "VALIDATION");

    const sql = `
      INSERT INTO public.data
        (name, type, governorate, min_score_required, fees, education_period, capacity, geom)
      VALUES
        ($1,$2,$3,$4,$5,$6,$7, ST_SetSRID(ST_MakePoint($8,$9),4326))
      RETURNING id, name;
    `;
    const { rows } = await pool.query(sql, [
      String(name).trim(),
      String(type || "").trim(),
      String(governorate || "").trim(),
      safeNum(min_score_required),
      safeNum(fees),
      String(education_period || "").trim(),
      safeNum(capacity),
      Number(lng),
      Number(lat),
    ]);

    return ok(res, { college: rows[0] });
  })
);

app.post(
  "/api/admin/hubs",
  authRequired,
  roleRequired("admin"),
  asyncHandler(async (req, res) => {
    const { name, lat, lng } = req.body || {};
    if (!name || lat == null || lng == null) return fail(res, 400, "name, lat, lng required", "VALIDATION");

    const sql = `
      INSERT INTO public.bus_hubs (name, geom)
      VALUES ($1, ST_SetSRID(ST_MakePoint($2,$3),4326))
      RETURNING id, name;
    `;
    const { rows } = await pool.query(sql, [String(name).trim(), Number(lng), Number(lat)]);
    return ok(res, { hub: rows[0] });
  })
);

/** ---------------- Not found + error middleware ---------------- */
app.use((req, res) => fail(res, 404, `Route not found: ${req.method} ${req.path}`, "NOT_FOUND"));

app.use((err, req, res, next) => {
  console.error(err);
  return fail(res, 500, err?.message || "Internal server error", "INTERNAL");
});

/** ---------------- Startup ---------------- */
async function start() {
  WAYS_ID_COL = await detectWaysIdColumn();
  ROUTE_GEOJSON_IS_JSON = await detectRouteGeojsonIsJsonb();

  console.log("Detected ways id column:", WAYS_ID_COL);
  console.log("student_choices.route_geojson is json?:", ROUTE_GEOJSON_IS_JSON);

  app.listen(PORT, () => {
    console.log(`API running on http://127.0.0.1:${PORT}`);
    console.log("Test: /health");
  });
}

start().catch((e) => {
  console.error("Startup failed:", e);
  process.exit(1);
});
