const axios = require('axios');

/**
 * @swagger
 * /orchestrator/create-and-confirm-order:
 * post:
 * summary: Orquestación completa de un pedido B2B.
 * description: Realiza tres pasos secuenciales: valida al cliente, crea la orden en estado CREATED y la confirma usando idempotencia.
 * tags: [Orchestrator]
 * requestBody:
 * required: true
 * content:
 * application/json:
 * schema:
 * type: object
 * required: [customer_id, items, idempotency_key]
 * properties:
 * customer_id:
 * type: integer
 * example: 1
 * items:
 * type: array
 * items:
 * type: object
 * properties:
 * product_id: { type: integer, example: 1 }
 * qty: { type: integer, example: 2 }
 * idempotency_key:
 * type: string
 * example: "uuid-pago-12345"
 * correlation_id:
 * type: string
 * example: "req-999"
 * responses:
 * 201:
 * description: Pedido orquestado y confirmado exitosamente.
 * 400:
 * description: Error en validación de datos o stock insuficiente.
 * 404:
 * description: Cliente no encontrado en el sistema.
 * 500:
 * description: Error interno en la orquestación.
 */
exports.orchestrateOrder = async (event) => {
    try {
        const body = JSON.parse(event.body);
        const { customer_id, items, idempotency_key, correlation_id } = body;

        // Limpieza de URLs para asegurar conectividad (usando puerto 3010 para Orders)
        const CUSTOMERS_BASE = (process.env.CUSTOMERS_API_BASE || 'http://localhost:3001').replace(/\/$/, '');
        const ORDERS_BASE = (process.env.ORDERS_API_BASE || 'http://localhost:3010').replace(/\/$/, '');
        const TOKEN = process.env.SERVICE_TOKEN || 'secret_token';

        if (!customer_id || !items || !idempotency_key) {
            return {
                statusCode: 400,
                body: JSON.stringify({ error: 'Faltan campos obligatorios: customer_id, items, idempotency_key' })
            };
        }

        const config = {
            headers: { Authorization: `Bearer ${TOKEN}` }
        };

        // 1. Validar Cliente en Customers API
        let customerData;
        try {
            const customerRes = await axios.get(
                `${CUSTOMERS_BASE}/internal/customers/${customer_id}`,
                config
            );
            customerData = customerRes.data;
        } catch (err) {
            return {
                statusCode: 404,
                body: JSON.stringify({ error: 'Cliente no encontrado o error en Customer API', detail: err.message })
            };
        }

        // 2. Crear Orden en Orders API (Estado: CREATED)
        let orderCreated;
        try {
            const orderRes = await axios.post(
                `${ORDERS_BASE}/orders`,
                { customer_id, items }
            );
            orderCreated = orderRes.data;
        } catch (err) {
            return {
                statusCode: 400,
                body: JSON.stringify({ error: 'Error al crear la orden', detail: err.response?.data || err.message })
            };
        }

        // 3. Confirmar Orden (Idempotente)
        let orderConfirmed;
        try {
            const confirmRes = await axios.post(
                `${ORDERS_BASE}/orders/${orderCreated.id}/confirm`,
                {},
                {
                    headers: { 'X-Idempotency-Key': idempotency_key }
                }
            )
            orderConfirmed = confirmRes.data.order;
        } catch (err) {
            return {
                statusCode: 500,
                body: JSON.stringify({ error: 'Error al confirmar la orden', detail: err.response?.data || err.message })
            };
        }

        // 4. Respuesta consolidada
        return {
            statusCode: 201,
            body: JSON.stringify({
                success: true,
                correlation_id: correlation_id || `req-${Date.now()}`,
                data: {
                    customer: customerData,
                    order: {
                        id: orderConfirmed.id,
                        status: orderConfirmed.status,
                        total_cents: orderConfirmed.total_cents,
                        items: items
                    }
                }
            })
        }
    } catch (error) {
        return {
            statusCode: 500,
            body: JSON.stringify({ error: 'Internal Server Error', message: error.message })
        };
    }
};