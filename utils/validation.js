const { body, validationResult } = require('express-validator');
const AppError = require('./appError');

// Middleware para verificar resultados da validação
exports.validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    const errorMessages = errors.array().map(err => ({
      field: err.path || err.param,
      message: err.msg
    }));

    return next(
      new AppError(
        `Validation failed: ${errorMessages.map(e => e.message).join(', ')}`,
        400
      )
    );
  }
  next();
};

const nameRules = field =>
  field
    .isString()
    .withMessage('Name must be text')
    .bail()
    .trim()
    .isLength({ min: 2, max: 50 })
    .withMessage('Name must be between 2 and 50 characters')
    .matches(/^[\p{L}\p{M}\s'.-]+$/u)
    .withMessage(
      'Name can only contain letters, spaces, apostrophes and hyphens'
    );

const emailRules = field =>
  field
    .isString()
    .withMessage('Email must be text')
    .bail()
    .trim()
    .isEmail()
    .withMessage('Please provide a valid email')
    .normalizeEmail();

const requiredName = () =>
  nameRules(body('name').notEmpty().withMessage('Name is required').bail());

const requiredEmail = () =>
  emailRules(body('email').notEmpty().withMessage('Email is required').bail());

const newPassword = requiredMessage =>
  body('password')
    .notEmpty()
    .withMessage(requiredMessage)
    .bail()
    .isString()
    .withMessage('Password must be text')
    .bail()
    .isLength({ min: 8 })
    .withMessage('Password must be at least 8 characters')
    // O bcrypt ignora tudo o que passar de 72 bytes
    .custom(value => Buffer.byteLength(value) <= 72)
    .withMessage('Password must be at most 72 bytes')
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
    .withMessage(
      'Password must contain at least one uppercase letter, one lowercase letter, and one number'
    );

const passwordConfirm = () =>
  body('passwordConfirm')
    .notEmpty()
    .withMessage('Password confirmation is required')
    .bail()
    .custom((value, { req }) => {
      if (value !== req.body.password) {
        throw new Error('Passwords do not match');
      }
      return true;
    });

const existingPassword = (field, requiredMessage) =>
  body(field)
    .notEmpty()
    .withMessage(requiredMessage)
    .bail()
    .isString()
    .withMessage('Password must be text');

// Validações para signup
exports.validateSignup = [
  requiredName(),
  requiredEmail(),
  newPassword('Password is required'),
  passwordConfirm()
];

// Validações para login
exports.validateLogin = [
  requiredEmail(),
  existingPassword('password', 'Password is required')
];

// Validações para reset password
exports.validateResetPassword = [
  newPassword('Password is required'),
  passwordConfirm()
];

// Validações para update password
exports.validateUpdatePassword = [
  existingPassword('passwordCurrent', 'Current password is required'),
  newPassword('New password is required'),
  passwordConfirm()
];

// Validações para forgot password
exports.validateForgotPassword = [requiredEmail()];

// Validações para actualizar nome e email (próprio utilizador ou admin)
exports.validateUpdateUser = [
  nameRules(body('name').optional()),
  emailRules(body('email').optional())
];
