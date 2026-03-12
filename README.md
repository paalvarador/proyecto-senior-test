# Sistema B2B: Gestión de Clientes y Pedidos Orquestados

Este proyecto es una solución backend de nivel Senior que integra microservicios, una base de datos relacional, idempotencia y orquestación de procesos mediante Lambdas (localmente con Serverless Offline).

## 🛠 Requisitos Previos

Antes de comenzar, asegurarse de tener instalado:
- Docker y Docker Compose.
- Node.js v22.x o superior.
- Postman, Insomnia o cualquier cliente HTTP.
- Framework Serverless global (opcional): npm install -g serverless.

## 🚀 Guía de Levantamiento (Setup)

### 1. Levantar Infraestructura (Base de Datos y APIs)

Desde la raíz del proyecto, ejecutar el siguiente comando para construir y levantar los contenedores:

```
docker-compose up --build -d
```

Esto levantará:
- MySQL (senior-test-db): En el puerto 3306.
- Customers API: En http://localhost:3001.
- Orders API: En http://localhost:3010 (Mapeado internamente al 3002).

### 2. Configurar el Orquestador (Lambda Local)

El orquestador coordina la comunicación entre las dos APIs.

1. Entrar a la carpeta: cd lambda-orchestrator.
2. Instalar las dependencias: npm install.
3. Asegúrarse de que el archivo .env tenga la siguiente configuración:

```
CUSTOMERS_API_BASE=http://localhost:3001
ORDERS_API_BASE=http://localhost:3010
SERVICE_TOKEN=secret_token
```

4. Iniciar el servicio en modo offline:

```
npx serverless offline
```

El orquestador estará disponible en: http://localhost:3003.

## 📬 Guía de Endpoints (Postman)

1. Orquestador (El flujo principal)

- POST /orchestrator/create-and-confirm-order
- URL: http://localhost:3003/orchestrator/create-and-confirm-order
- Body (JSON):

```
{
  "customer_id": 1,
  "items": [
    { "product_id": 1, "qty": 1 },
    { "product_id": 2, "qty": 2 }
  ],
  "idempotency_key": "pago-unique-001",
  "correlation_id": "req-999"
}
```

2. Customers API (Gestión de Clientes)
- GET ```/customers``` (Búsqueda/Paginación): ```http://localhost:3001/customers?search=ACME&limit=5```
- POST /customers (Crear): ```{"name": "Nuevo Cliente", "email": "test@test.com"}```
- PUT ```/customers/:id``` (Actualizar): ```{"phone": "+5411..."}```
- DELETE ```/customers/:id``` (Borrado Lógico): Marca ```is_deleted = 1```.

3. Orders API (Gestión de Productos y Pedidos)
- POST ```/products``` (Crear stock): ```{"sku": "SKU1", "name": "Item", "price_cents": 1000, "stock": 50}```
- POST ```/orders/:id/confirm``` (Confirmación con Idempotencia):
- Header: ```X-Idempotency-Key: tu-llave-aqui```
- Nota: Si repites la llave, recibirás la misma respuesta sin duplicar el proceso.

- POST ```/orders/:id/cancel``` (Cancelación):
- Si es ```CREATED```: Cancela siempre.
- Si es ```CONFIRMED```: Solo en los primeros 10 minutos.

## 🧪 Escenarios de Prueba Senior

1. Prueba de Idempotencia: Envía el pedido al orquestador. Recibe el éxito. Vuelve a enviar exactamente el mismo JSON con la misma idempotency_key. Verás que el sistema no crea una nueva orden ni falla, sino que retorna el resultado previo (Cache de base de datos).
2. Prueba de Stock: Intenta comprar 100 unidades de un producto que solo tiene 10. El sistema debe responder con un error 400 y no crear la orden.
3. Prueba de Soft-Delete: Elimina un cliente y luego intenta obtener la lista total. El cliente no debería aparecer, pero seguirá existiendo en la tabla de la base de datos con is_deleted = 1.

## 🛠 Comandos Útiles de DB

### Ver órdenes y estados
```
docker exec -it senior-test-db mysql -uuser -ppassword test_db -e "SELECT * FROM orders;"
```

### Ver customers
```
docker exec -it senior-test-db mysql -uuser -ppassword test_db -e "SELECT * FROM customers;"
```

### Ver products
```
docker exec -it senior-test-db mysql -uuser -ppassword test_db -e "SELECT * FROM products;"
```

### Ver llaves de idempotencia registradas

```
docker exec -it senior-test-db mysql -uuser -ppassword test_db -e "SELECT * FROM idempotency_keys;"
```
