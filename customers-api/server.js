const express = require("express");
const mysql = require("mysql2/promise");
const { z } = require("zod");
const cors = require("cors");

const app = express();
app.use(cors()); // Habilitado para permitir pruebas desde Swagger/Web
app.use(express.json());

const pool = mysql.createPool({
  host: process.env.DB_HOST || "db",
  user: process.env.DB_USER || "user",
  password: process.env.DB_PASSWORD || "password",
  database: process.env.DB_NAME || "test_db",
  waitForConnections: true,
  connectionLimit: 10,
});

const SERVICE_TOKEN = process.env.SERVICE_TOKEN || "secret_token";

// Middleware de Auth para comunicación entre servicios (/internal)
const authMiddleware = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || authHeader !== `Bearer ${SERVICE_TOKEN}`) {
    return res.status(401).json({
      error: "No autorizado: Token de servicio inválido o ausente",
    });
  }
  next();
};

/**
 * Health Check
 */
app.get("/health", (req, res) =>
  res.send({ status: "OK", service: "Customers" }),
);

/**
 * GET /customers
 * Lista clientes con búsqueda (?search) y paginación por cursor (?cursor & ?limit)
 */
app.get("/customers", async (req, res) => {
  try {
    const { search, cursor } = req.query;

    // Validar limit para que sea siempre un número válido
    let limit = parseInt(req.query.limit);
    if (isNaN(limit) || limit <= 0) limit = 10;

    let query =
      "SELECT id, name, email, phone, created_at FROM customers WHERE is_deleted = 0";
    const params = [];

    if (search) {
      query += " AND (name LIKE ? OR email LIKE ?)";
      params.push(`%${search}%`, `%${search}%`);
    }

    if (cursor) {
      const cursorInt = parseInt(cursor);
      if (!isNaN(cursorInt)) {
        query += " AND id > ?";
        params.push(cursorInt);
      }
    }

    query += " ORDER BY id ASC LIMIT ?";
    params.push(limit);

    const [rows] = await pool.query(query, params);

    const nextCursor = rows.length > 0 ? rows[rows.length - 1].id : null;

    res.json({
      data: rows,
      meta: {
        next_cursor: nextCursor,
        count: rows.length,
      },
    });
  } catch (e) {
    console.error("Error en lista de clientes:", e);
    res.status(500).json({
      error: "Error al listar clientes",
      detail: e.message,
    });
  }
});

/**
 * GET /customers/:id
 * Detalle público de un cliente
 */
app.get("/customers/:id", async (req, res) => {
  try {
    const [rows] = await pool.execute(
      "SELECT id, name, email, phone, created_at FROM customers WHERE id = ? AND is_deleted = 0",
      [req.params.id],
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: "Cliente no encontrado" });
    }

    res.json(rows[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/**
 * POST /customers
 * Crea un nuevo cliente
 */
app.post("/customers", async (req, res) => {
  const customerSchema = z.object({
    name: z.string().min(1, "El nombre es requerido"),
    email: z.string().email("Email inválido"),
    phone: z.string().optional(),
  });

  try {
    const data = customerSchema.parse(req.body);

    const [result] = await pool.execute(
      "INSERT INTO customers (name, email, phone) VALUES (?, ?, ?)",
      [data.name, data.email, data.phone || null],
    );
    res.status(201).json({ id: result.insertId, ...data });
  } catch (e) {
    if (e instanceof z.ZodError)
      return res
        .status(400)
        .json({ error: "Error de validación", details: e.errors });
    res.status(400).json({ error: e.message });
  }
});

/**
 * PUT /customers/:id
 * Actualiza parcialmente un cliente
 */
app.put("/customers/:id", async (req, res) => {
  const updateSchema = z.object({
    name: z.string().min(1).optional(),
    email: z.string().email().optional(),
    phone: z.string().optional(),
  });

  try {
    const data = updateSchema.parse(req.body);
    const fields = [];
    const values = [];

    for (const [key, val] of Object.entries(data)) {
      if (val !== undefined) {
        fields.push(`${key} = ?`);
        values.push(val);
      }
    }

    if (fields.length === 0)
      return res.status(400).json({ error: "No hay campos para actualizar" });

    values.push(req.params.id);
    const [result] = await pool.execute(
      `UPDATE customers SET ${fields.join(", ")} WHERE id = ? AND is_deleted = 0`,
      values,
    );

    if (result.affectedRows === 0)
      return res.status(404).json({ error: "Cliente no encontrado" });

    res.json({ success: true, message: "Cliente actualizado" });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

/**
 * DELETE /customers/:id
 * Borrado lógico (Soft-delete)
 */
app.delete("/customers/:id", async (req, res) => {
  try {
    const [result] = await pool.execute(
      "UPDATE customers SET is_deleted = 1 WHERE id = ?",
      [req.params.id],
    );

    if (result.affectedRows === 0)
      return res.status(404).json({ error: "Cliente no encontrado" });

    res.json({ success: true, message: "Cliente eliminado correctamente" });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/**
 * GET /internal/customers/:id
 * Uso interno (Orquestador / Orders)
 */
app.get("/internal/customers/:id", authMiddleware, async (req, res) => {
  try {
    const [rows] = await pool.execute("SELECT * FROM customers WHERE id = ?", [
      req.params.id,
    ]);

    if (rows.length === 0) {
      return res.status(404).json({ error: "Cliente no encontrado" });
    }

    res.json(rows[0]);
  } catch (err) {
    res
      .status(500)
      .json({ error: "Error en la base de datos", detail: err.message });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, "0.0.0.0", () =>
  console.log(`Customers API ejecutándose en puerto ${PORT}`),
);
