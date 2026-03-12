const express = require("express");
const mysql = require("mysql2/promise");
const axios = require("axios");
const { z } = require("zod");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json());

// Configuración del pool con logs de conexión
const pool = mysql.createPool({
  host: process.env.DB_HOST || "db",
  user: process.env.DB_USER || "user",
  password: process.env.DB_PASSWORD || "password",
  database: process.env.DB_NAME || "test_db",
  waitForConnections: true,
  connectionLimit: 10,
});

const CUSTOMERS_API_BASE =
  process.env.CUSTOMERS_API_BASE || "http://customers-api:3001";
const SERVICE_TOKEN = process.env.SERVICE_TOKEN || "secret_token";

// Middleware para loguear cada petición que llega
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

app.get("/health", (req, res) => res.send({ status: "OK", service: "Orders" }));

// ==========================================
// ENDPOINTS DE PRODUCTOS
// ==========================================

/**
 * POST /products
 * Crea un nuevo producto.
 */
app.post("/products", async (req, res) => {
  const productSchema = z.object({
    sku: z.string().min(1),
    name: z.string().min(1),
    price_cents: z.number().int().positive(),
    stock: z.number().int().nonnegative(),
  });

  try {
    const data = productSchema.parse(req.body);
    const [result] = await pool.execute(
      "INSERT INTO products (sku, name, price_cents, stock) VALUES (?, ?, ?, ?)",
      [data.sku, data.name, data.price_cents, data.stock],
    );
    res.status(201).json({ id: result.insertId, ...data });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/**
 * PATCH /products/:id
 * Actualiza precio o stock de un producto.
 */
app.patch("/products/:id", async (req, res) => {
  const patchSchema = z.object({
    price_cents: z.number().int().positive().optional(),
    stock: z.number().int().nonnegative().optional(),
  });

  try {
    const data = patchSchema.parse(req.body);
    const fields = [];
    const values = [];

    for (const [key, val] of Object.entries(data)) {
      if (val !== undefined) {
        fields.push(`${key} = ?`);
        values.push(val);
      }
    }

    if (fields.length === 0)
      return res.status(400).json({ error: "No fields to update" });

    values.push(req.params.id);
    const [result] = await pool.execute(
      `UPDATE products SET ${fields.join(", ")} WHERE id = ?`,
      values,
    );

    if (result.affectedRows === 0)
      return res.status(404).json({ error: "Product not found" });
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/**
 * GET /products/:id
 */
app.get("/products/:id", async (req, res) => {
  try {
    const [rows] = await pool.execute("SELECT * FROM products WHERE id = ?", [
      req.params.id,
    ]);
    if (rows.length === 0)
      return res.status(404).json({ error: "Product not found" });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /products
 * Búsqueda y paginación por cursor.
 */
app.get("/products", async (req, res) => {
  try {
    const { search, cursor } = req.query;
    let limit = parseInt(req.query.limit);
    if (isNaN(limit) || limit <= 0) limit = 10;

    let query = "SELECT * FROM products WHERE 1=1";
    const params = [];

    if (search) {
      query += " AND (name LIKE ? OR sku LIKE ?)";
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
    res.json({ data: rows, next_cursor: nextCursor });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// ENDPOINTS DE ÓRDENES
// ==========================================

/**
 * GET /orders
 * Búsqueda con filtros y paginación por cursor.
 */
app.get("/orders", async (req, res) => {
  try {
    const { status, from, to, cursor } = req.query;

    let limit = parseInt(req.query.limit);
    if (isNaN(limit) || limit <= 0) limit = 10;

    let query = "SELECT * FROM orders WHERE 1=1";
    const params = [];

    if (status) {
      query += " AND status = ?";
      params.push(status);
    }
    if (from) {
      query += " AND created_at >= ?";
      params.push(from);
    }
    if (to) {
      query += " AND created_at <= ?";
      params.push(to);
    }
    if (cursor) {
      const cursorInt = parseInt(cursor);
      if (!isNaN(cursorInt)) {
        query += " AND id < ?"; // Paginación descendente
        params.push(cursorInt);
      }
    }

    query += " ORDER BY id DESC LIMIT ?";
    params.push(limit);

    // Cambiado pool.execute -> pool.query
    const [rows] = await pool.query(query, params);
    const nextCursor = rows.length > 0 ? rows[rows.length - 1].id : null;

    res.json({ data: rows, next_cursor: nextCursor });
  } catch (err) {
    console.error("Error en lista de órdenes:", err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /orders/:id
 * Detalle de orden incluyendo sus items.
 */
app.get("/orders/:id", async (req, res) => {
  try {
    const [orders] = await pool.execute("SELECT * FROM orders WHERE id = ?", [
      req.params.id,
    ]);
    if (orders.length === 0)
      return res.status(404).json({ error: "Orden no encontrada" });

    const order = orders[0];
    const [items] = await pool.execute(
      "SELECT * FROM order_items WHERE order_id = ?",
      [req.params.id],
    );

    res.json({ ...order, items });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /orders
 * Crea una orden en estado CREATED y descuenta stock.
 */
app.post("/orders", async (req, res) => {
  const orderSchema = z.object({
    customer_id: z.number(),
    items: z
      .array(
        z.object({
          product_id: z.number(),
          qty: z.number().min(1),
        }),
      )
      .min(1),
  });

  const conn = await pool.getConnection();
  try {
    const { customer_id, items } = orderSchema.parse(req.body);

    // 1. Validar Cliente en Customers API (Internal)
    try {
      await axios.get(
        `${CUSTOMERS_API_BASE}/internal/customers/${customer_id}`,
        {
          headers: { Authorization: `Bearer ${SERVICE_TOKEN}` },
        },
      );
    } catch (err) {
      return res
        .status(404)
        .json({ error: "Cliente no válido o no encontrado" });
    }

    await conn.beginTransaction();
    let totalCents = 0;
    const processedItems = [];

    // 2. Verificar stock y preparar items
    for (const item of items) {
      const [products] = await conn.execute(
        "SELECT id, name, price_cents, stock FROM products WHERE id = ? FOR UPDATE",
        [item.product_id],
      );

      const product = products[0];
      if (!product) throw new Error(`Producto ${item.product_id} no existe`);
      if (product.stock < item.qty)
        throw new Error(`Stock insuficiente para ${product.name}`);

      const subtotal = product.price_cents * item.qty;
      totalCents += subtotal;

      processedItems.push({
        product_id: product.id,
        qty: item.qty,
        unit_price: product.price_cents,
        subtotal,
      });

      // Descontar stock
      await conn.execute("UPDATE products SET stock = stock - ? WHERE id = ?", [
        item.qty,
        product.id,
      ]);
    }

    // 3. Crear orden
    const [orderResult] = await conn.execute(
      'INSERT INTO orders (customer_id, total_cents, status) VALUES (?, ?, "CREATED")',
      [customer_id, totalCents],
    );
    const orderId = orderResult.insertId;

    // 4. Insertar items
    for (const pi of processedItems) {
      await conn.execute(
        "INSERT INTO order_items (order_id, product_id, qty, unit_price_cents, subtotal_cents) VALUES (?, ?, ?, ?, ?)",
        [orderId, pi.product_id, pi.qty, pi.unit_price, pi.subtotal],
      );
    }

    await conn.commit();
    res
      .status(201)
      .json({ id: orderId, status: "CREATED", total_cents: totalCents });
  } catch (err) {
    if (conn) await conn.rollback();
    res.status(400).json({ error: err.message });
  } finally {
    conn.release();
  }
});

/**
 * POST /orders/:id/confirm
 * Confirmación idempotente con X-Idempotency-Key.
 */
app.post("/orders/:id/confirm", async (req, res) => {
  const idempotencyKey = req.headers["x-idempotency-key"];
  if (!idempotencyKey)
    return res.status(400).json({ error: "X-Idempotency-Key requerida" });

  try {
    const [existing] = await pool.execute(
      "SELECT response_body FROM idempotency_keys WHERE idempotency_key = ?",
      [idempotencyKey],
    );

    if (existing.length > 0) {
      return res.json(existing[0].response_body);
    }

    const [result] = await pool.execute(
      'UPDATE orders SET status = "CONFIRMED" WHERE id = ? AND status = "CREATED"',
      [req.params.id],
    );
    if (result.affectedRows === 0)
      return res
        .status(400)
        .json({
          error: "No se pudo confirmar la orden (ya confirmada o no existe)",
        });

    const [rows] = await pool.execute("SELECT * FROM orders WHERE id = ?", [
      req.params.id,
    ]);
    const response = { success: true, order: rows[0] };

    await pool.execute(
      "INSERT INTO idempotency_keys (idempotency_key, response_body) VALUES (?, ?)",
      [idempotencyKey, response],
    );

    res.json(response);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /orders/:id/cancel
 * Regla: CREATED cancela siempre; CONFIRMED solo dentro de 10 min. Restaura stock.
 */
app.post("/orders/:id/cancel", async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [orders] = await conn.execute(
      "SELECT * FROM orders WHERE id = ? FOR UPDATE",
      [req.params.id],
    );
    const order = orders[0];

    if (!order) return res.status(404).json({ error: "Orden no encontrada" });
    if (order.status === "CANCELED")
      return res.status(400).json({ error: "La orden ya está cancelada" });

    // Regla de los 10 minutos para CONFIRMED
    if (order.status === "CONFIRMED") {
      const createdAt = new Date(order.created_at);
      const now = new Date();
      const diffMs = now - createdAt;
      const diffMins = diffMs / 1000 / 60;

      if (diffMins > 10) {
        throw new Error(
          "No se puede cancelar una orden confirmada después de 10 minutos",
        );
      }
    }

    // Restituir stock
    const [items] = await conn.execute(
      "SELECT product_id, qty FROM order_items WHERE order_id = ?",
      [req.params.id],
    );
    for (const item of items) {
      await conn.execute("UPDATE products SET stock = stock + ? WHERE id = ?", [
        item.qty,
        item.product_id,
      ]);
    }

    // Cambiar estado a CANCELED
    await conn.execute('UPDATE orders SET status = "CANCELED" WHERE id = ?', [
      req.params.id,
    ]);

    await conn.commit();
    res.json({ success: true, message: "Orden cancelada y stock restaurado" });
  } catch (err) {
    if (conn) await conn.rollback();
    res.status(400).json({ error: err.message });
  } finally {
    conn.release();
  }
});

const PORT = process.env.PORT || 3010;
app.listen(PORT, () => console.log(`Orders API escuchando en puerto ${PORT}`));
