# Sistema B2B: Guia de Instalación y Pruebas

Este documento los guiará paso a paso para poner en marcha el sistema de microservicios y el
orquestador Lambda en el entorno local.

## 📋 Prerrequisitos

Antes de comenzar, asegurarse de tener instalado:
- Docker Desktop.
- Node.js v22.x o superior.
- Postman, Insomnia o cualquier cliente HTTP.
- Framework Serverless global (opcional): npm install -g serverless.

## 🛠 Paso 1: Descargar el Proyecto

Primero, se debe clonar el repositorio desde GitHub e ingresar en la
carpeta principal

```
git clone <URL_DEL_REPOSITORIO>
cd proyecto-senior-test
```

## 🔐 Paso 2: Configuración de Variables de Entorno
El sistema necesita archivos ```.env``` en tres carpetas distintas para saber como conectarse entre si. Se debe crear un archivo llamado ```.env``` en cada una de las siguientes rutas

1. En ```customers-api/.env

```
PORT=3001
NODE_ENV=development
DB_HOST=db
DB_USER=user
DB_PASSWORD=password
DB_NAME=test_db
SERVICE_TOKEN=secret_token
```

2. En ```orders-api/.env```

```
PORT=3010
NODE_ENV=development
DB_HOST=db
DB_USER=user
DB_PASSWORD=password
DB_NAME=test_db
CUSTOMERS_API_BASE=http://customers-api:3001
SERVICE_TOKEN=secret_token
```

3. En ```lambda-orchestrator```

```
CUSTOMERS_API_BASE=http://localhost:3001
ORDERS_API_BASE=http://localhost:3010
SERVICE_TOKEN=secret_token
```

### Paso 3. Levantar la Infraestructura (Docker)

Ahora se debe levnatar la base de datos y las dos APIs principales usando Docker. Desde la raíz del proyecto se debe ejecutar el siguiente comando

```
docker-compose up --build -d
```

- Customers API: Estará disponible en ```http://localhost:3001```
- Orders API: Estará disponible en ```http://localhost:3010```
- MySQL: Estará corriendo internamente en el puerto ```3306```

### Paso 4: Iniciar el Orquestador (Lambda Local)

El orquestador es el encargado de unir los procesos de ambas APIs. Se debe ejecutar manualmente en una terminal aparte:

1. Ingresar en la carpeta: ```cd lambda-orchestrator```
2. Instalar las librerias: ```npm installl```
3. Iniciar el servicio: ```npx serverless offline```

El orquestador estará escuchando en: ```http://localhost:3000```

## 🚀 Paso 5: Pruebas con Postman

Para probar el flujo completo se debe ejecutar los requests desde Postman

- Método: POST
- URL: ```http://localhost:3003/orchestrator/create-and-confirm-order```
- Body (JSON):

```
{
  "customer_id": 1,
  "items": [
    { "product_id": 1, "qty": 1 },
    { "product_id": 2, "qty": 2 }
  ],
  "idempotency_key": "pago-unico-001",
  "correlation_id": "req-999"
}
```

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
