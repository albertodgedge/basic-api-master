# API base

Base reutilizável para APIs REST com Node.js, Express e MongoDB: autenticação JWT, gestão de utilizadores, CRUD genérico, tratamento de erros, segurança e emails. Não tem domínio de negócio: cada projecto acrescenta os seus recursos.

## Como começar

Requer Node.js 22.13+ e MongoDB.

```bash
npm install
cp config.env.example config.env   # preencher JWT_SECRET
npm run dev
```

Todas as variáveis estão descritas em [config.env.example](config.env.example). A API recusa arrancar sem `DATABASE`, `APP_URL` e um `JWT_SECRET` com pelo menos 32 caracteres.

Sem SMTP configurado a API funciona na mesma: o registo conclui e o erro de envio fica no log. A recuperação de password é que precisa de email.

## Endpoints

Todos com o prefixo `/api/v1/users`. A autenticação usa o header `Authorization: Bearer <token>` ou o cookie `jwt`.

| Método | Caminho                 | Acesso      | Descrição                                    |
| ------ | ----------------------- | ----------- | -------------------------------------------- |
| POST   | `/signup`               | Público     | Cria a conta e devolve o token               |
| POST   | `/login`                | Público     | Devolve o token                              |
| GET    | `/logout`               | Público     | Limpa o cookie                               |
| POST   | `/forgotPassword`       | Público     | Envia o token de recuperação por email       |
| PATCH  | `/resetPassword/:token` | Público     | Define uma nova password com esse token      |
| GET    | `/me`                   | Autenticado | Devolve o próprio perfil                     |
| PATCH  | `/updateMe`             | Autenticado | Altera `name`, `email` e `photo` (multipart) |
| PATCH  | `/updateMyPassword`     | Autenticado | Altera a própria password                    |
| DELETE | `/deleteMe`             | Autenticado | Desactiva a própria conta                    |
| GET    | `/`                     | Admin       | Lista os utilizadores                        |
| GET    | `/:id`                  | Admin       | Devolve um utilizador                        |
| PATCH  | `/:id`                  | Admin       | Altera `name`, `email` e `role`              |
| DELETE | `/:id`                  | Admin       | Apaga um utilizador                          |

As listagens aceitam filtros, ordenação, selecção de campos e paginação (máximo de 100 resultados por página):

```
GET /api/v1/users?role=admin&sort=-name&fields=name,email&page=2&limit=10
```

Os filtros também aceitam `gte`, `gt`, `lte` e `lt`, como em `?price[gte]=100`. Os campos do modelo com `select: false` são ignorados em todos estes parâmetros.

## Criar o primeiro admin

O registo cria sempre contas com `role: user`. Depois de registar a conta, promove-a na base de dados com o `mongosh my-api`:

```
db.users.updateOne({ email: 'admin@example.com' }, { $set: { role: 'admin' } })
```

## Acrescentar um recurso

1. Modelo em `models/productModel.js`:

```js
const mongoose = require('mongoose');

const productSchema = new mongoose.Schema({
  name: { type: String, required: [true, 'A product must have a name'] },
  price: { type: Number, required: [true, 'A product must have a price'] },
  tags: [String]
});

module.exports = mongoose.model('Product', productSchema);
```

2. Controller em `controllers/productController.js`:

```js
const Product = require('./../models/productModel');
const factory = require('./handlerFactory');

exports.getAllProducts = factory.getAll(Product);
exports.getProduct = factory.getOne(Product);
exports.createProduct = factory.createOne(Product);
exports.updateProduct = factory.updateOne(Product);
exports.deleteProduct = factory.deleteOne(Product);
```

3. Rotas em `routes/productRoutes.js`:

```js
const express = require('express');
const productController = require('./../controllers/productController');
const authController = require('./../controllers/authController');

const router = express.Router();

router.get('/', productController.getAllProducts);
router.get('/:id', productController.getProduct);

router.use(authController.protect, authController.restrictTo('admin'));

router.post('/', productController.createProduct);
router
  .route('/:id')
  .patch(productController.updateProduct)
  .delete(productController.deleteProduct);

module.exports = router;
```

4. Montar as rotas em `app.js`, antes do middleware que responde 404:

```js
app.use('/api/v1/products', require('./routes/productRoutes'));
```

`createOne` e `updateOne` guardam o corpo do pedido tal como vem. Em rotas abertas a utilizadores normais, filtra primeiro os campos permitidos, como faz `filterUserUpdate` em [controllers/userController.js](controllers/userController.js), e valida-os como em [utils/validation.js](utils/validation.js). Marca com `select: false` os campos que o cliente nunca deve ver.

## O que ajustar em cada projecto

- **Papéis:** o `enum` de `role` em [models/userModel.js](models/userModel.js).
- **Emails:** os templates em [views/email/](views/email/).
- **Recuperação de password:** o email envia o URL da própria API, que recebe um `PATCH`. Com um frontend, muda `resetURL` em [controllers/authController.js](controllers/authController.js) para a página do frontend.
- **Validação:** as regras de registo e password em [utils/validation.js](utils/validation.js).
- **HTML guardado:** [utils/sanitizeHtml.js](utils/sanitizeHtml.js) escapa `<` e `>` em todos os textos recebidos; ajusta-o se um recurso tiver de guardar HTML ou texto com esses caracteres.

## Antes de ir para produção

- `NODE_ENV=production` e um `JWT_SECRET` próprio, gerado com o comando indicado em `config.env.example`
- `TRUST_PROXY_HOPS` igual ao número de proxies à frente da app; sem isto os limites de pedidos e o IP nos logs ficam errados
- `APP_URL` e `ALLOWED_ORIGINS` com os domínios reais
- HTTPS: fora de desenvolvimento, o cookie `jwt` só é enviado por HTTPS e o email só sai por SMTP com TLS
- Com várias instâncias, um `store` partilhado (por exemplo Redis) nos limitadores de [app.js](app.js), que por omissão contam em memória, por processo
- `npm audit` no CI: as vulnerabilidades em dependências aparecem ao longo do tempo

## Segurança incluída

- Headers HTTP com Helmet e CORS restrito a `ALLOWED_ORIGINS`
- Limites de pedidos por IP: geral, falhas de autenticação, e envio de emails (registo e recuperação)
- Sanitização contra NoSQL injection e XSS; protecção contra parameter pollution
- Corpo dos pedidos limitado a 10 KB
- Passwords com bcrypt (custo 12) e requisitos de complexidade; tokens de recuperação guardados com SHA-256, válidos 10 minutos e de uso único
- JWT com algoritmo fixo, `issuer` e `audience`, invalidado quando a password muda
- Cookie `jwt` com `httpOnly`, `secure` e `sameSite`
- Login sem diferenças entre email inexistente e password errada; `forgotPassword` não revela se o email existe, nem pelo tempo de resposta
- Links de email construídos a partir de `APP_URL`, nunca do header `Host`
- Uploads limitados a 5 MB e 50 megapixels, só JPEG, PNG e WebP, verificados pelo conteúdo real e guardados sem metadados
- Campos internos do utilizador nunca saem nas respostas
- Fora de desenvolvimento, os erros inesperados não expõem detalhes internos

## O que não está incluído

- Confirmação do email no registo
- Refresh tokens e autenticação de dois factores
- Revogação de tokens: depois do logout, um JWT continua válido até expirar ou até a password mudar
- Bloqueio de conta após tentativas falhadas: os limites são por IP, não por conta

