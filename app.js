const path = require('path');
const express = require('express');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const slowDown = require('express-slow-down');
const helmet = require('helmet');
const mongoSanitize = require('express-mongo-sanitize');
const hpp = require('hpp');
const cookieParser = require('cookie-parser');
const compression = require('compression');
const cors = require('cors');

const AppError = require('./utils/appError');
const sanitizeHtml = require('./utils/sanitizeHtml');
const globalErrorHandler = require('./controllers/errorController');
const userRouter = require('./routes/userRoutes');

// Start express app
const app = express();

// Número de proxies à frente da app: ver TRUST_PROXY_HOPS em config.env.example
// Nunca usar `true`: qualquer cliente contornava o rate limiting falsificando o IP
app.set('trust proxy', Number(process.env.TRUST_PROXY_HOPS) || false);

// O parser por omissão do Express 5 não lê filtros como ?price[gte]=100
app.set('query parser', 'extended');

// 1) GLOBAL MIDDLEWARES
// Set security HTTP headers
// cross-origin: um frontend noutro domínio pode mostrar as fotos dos utilizadores
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));

// Implement CORS com configurações mais restritivas
const corsOptions = {
  origin: function (origin, callback) {
    // Lista de origens permitidas
    const allowedOrigins = process.env.ALLOWED_ORIGINS
      ? process.env.ALLOWED_ORIGINS.split(',')
      : ['http://localhost:3000', 'http://localhost:8000'];

    // Pedidos sem origin (mobile apps, Postman, etc) também são permitidos
    if (allowedOrigins.indexOf(origin) !== -1 || !origin) {
      callback(null, true);
    } else {
      callback(new AppError('Not allowed by CORS', 403));
    }
  },
  credentials: true,
  optionsSuccessStatus: 200,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
};

app.use(cors(corsOptions));

// Serving static files (fotos dos utilizadores)
app.use(express.static(path.join(__dirname, 'public')));

// Development logging
if (process.env.NODE_ENV === 'development') {
  app.use(morgan('dev'));
} else {
  // Logging mais seguro em produção (sem informações sensíveis)
  app.use(
    morgan('combined', {
      skip: (req, res) => res.statusCode < 400
    })
  );
}

// Rate limiting geral para API
const limiter = rateLimit({
  limit: Number(process.env.RATE_LIMIT_MAX) || 100,
  windowMs: 60 * 60 * 1000, // 1 hora
  message: {
    status: 'error',
    message: 'Too many requests from this IP, please try again in an hour!'
  },
  standardHeaders: true,
  legacyHeaders: false
});

// Rate limiting mais restritivo para autenticação: conta só as tentativas falhadas
const authLimiter = rateLimit({
  limit: Number(process.env.AUTH_RATE_LIMIT_MAX) || 5,
  windowMs: 15 * 60 * 1000, // 15 minutos
  message: {
    status: 'error',
    message:
      'Too many login attempts from this IP, please try again after 15 minutes!'
  },
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false
});

// Estas rotas enviam emails e respondem quase sempre com sucesso: contam todos os
// pedidos, para não servirem para inundar a caixa de correio de alguém
const emailLimiter = rateLimit({
  limit: Number(process.env.AUTH_RATE_LIMIT_MAX) || 5,
  windowMs: 60 * 60 * 1000, // 1 hora
  message: {
    status: 'error',
    message: 'Too many requests from this IP, please try again in an hour!'
  },
  standardHeaders: true,
  legacyHeaders: false
});

// Slow down requests após muitas tentativas
const speedLimiter = slowDown({
  windowMs: 15 * 60 * 1000, // 15 minutos
  delayAfter: 50, // Começar a atrasar após 50 requisições
  delayMs: () => 500 // Atraso de 500ms por requisição após o limite
});

app.use('/api', limiter);
app.use('/api/v1/users/login', authLimiter);
app.use('/api/v1/users/resetPassword', authLimiter);
app.use('/api/v1/users/updateMyPassword', authLimiter);
app.use('/api/v1/users/signup', emailLimiter);
app.use('/api/v1/users/forgotPassword', emailLimiter);
app.use('/api', speedLimiter);

// Body parser, reading data from body into req.body
app.use(
  express.json({
    limit: '10kb',
    strict: true // Rejeitar objetos e arrays não primitivos
  })
);
app.use(
  express.urlencoded({
    extended: true,
    limit: '10kb',
    parameterLimit: 50 // Limitar número de parâmetros
  })
);
app.use(cookieParser());

// Express 5: req.query é só de leitura e req.body fica undefined num pedido sem corpo.
// Os sanitizers e os controllers precisam de ambos como objectos normais
app.use((req, res, next) => {
  Object.defineProperty(req, 'query', {
    value: req.query,
    writable: true,
    enumerable: true,
    configurable: true
  });
  req.body = req.body || {};
  next();
});

// Data sanitization against NoSQL query injection
app.use(
  mongoSanitize({
    replaceWith: '_',
    onSanitize: ({ req, key }) => {
      console.warn(
        `NoSQL injection attempt detected: ${key} from IP ${req.ip}`
      );
    }
  })
);

// Data sanitization against XSS
app.use(sanitizeHtml);

// Prevent parameter pollution
// Para aceitar um filtro repetido na query (?price=1&price=2): hpp({ whitelist: ['price'] })
app.use(hpp());

app.use(compression());

// 2) ROUTES
app.use('/api/v1/users', userRouter);

app.use((req, res, next) => {
  next(new AppError(`Can't find ${req.originalUrl} on this server!`, 404));
});

app.use(globalErrorHandler);

module.exports = app;
