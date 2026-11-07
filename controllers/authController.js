const crypto = require('crypto');
const { promisify } = require('util');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const User = require('./../models/userModel');
const catchAsync = require('./../utils/catchAsync');
const AppError = require('./../utils/appError');
const Email = require('./../utils/email');

const JWT_ALGORITHM = 'HS256';
const jwtClaims = {
  issuer: process.env.JWT_ISSUER || 'api',
  audience: process.env.JWT_AUDIENCE || 'api-client'
};

const signToken = id => {
  return jwt.sign({ id }, process.env.JWT_SECRET, {
    algorithm: JWT_ALGORITHM,
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
    ...jwtClaims
  });
};

const cookieOptions = expires => ({
  expires,
  httpOnly: true,
  secure: process.env.NODE_ENV !== 'development',
  sameSite: process.env.NODE_ENV === 'development' ? 'lax' : 'strict',
  path: '/'
});

const createSendToken = (user, statusCode, res) => {
  const token = signToken(user._id);

  const cookieDays = process.env.JWT_COOKIE_EXPIRES_IN || 7;
  res.cookie(
    'jwt',
    token,
    cookieOptions(new Date(Date.now() + cookieDays * 24 * 60 * 60 * 1000))
  );

  res.status(statusCode).json({
    status: 'success',
    token,
    data: {
      user
    }
  });
};

exports.signup = catchAsync(async (req, res, next) => {
  const newUser = await User.create({
    name: req.body.name,
    email: req.body.email,
    password: req.body.password,
    passwordConfirm: req.body.passwordConfirm
  });

  // O utilizador já foi criado: uma falha no email não deve fazer falhar o registo
  try {
    await new Email(newUser).sendWelcome();
  } catch (err) {
    console.error('Error sending welcome email:', err);
  }

  createSendToken(newUser, 201, res);
});

exports.login = catchAsync(async (req, res, next) => {
  const { email, password } = req.body;

  // 1) Check if email and password exist
  if (!email || !password) {
    return next(new AppError('Please provide email and password!', 400));
  }

  // 2) Check if user exists && password is correct
  // Proteção contra timing attacks: sempre fazer hash mesmo se usuário não existir
  const user = await User.findOne({ email: email.toLowerCase() }).select(
    '+password'
  );

  // Sempre executar bcrypt.compare para evitar timing attacks
  // Se usuário não existir, comparar com hash dummy
  const dummyHash =
    '$2a$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LewY5GyY5Y5Y5Y5Y5';
  const passwordMatch = user
    ? await user.correctPassword(password, user.password)
    : await bcrypt.compare(password, dummyHash);

  if (!user || !passwordMatch) {
    // Adicionar pequeno delay para evitar timing attacks
    await new Promise(resolve => setTimeout(resolve, 100));
    return next(new AppError('Incorrect email or password', 401));
  }

  // 3) If everything ok, send token to client
  createSendToken(user, 200, res);
});

exports.logout = (req, res) => {
  res.cookie(
    'jwt',
    'loggedout',
    cookieOptions(new Date(Date.now() + 10 * 1000))
  );
  res.status(200).json({ status: 'success' });
};

exports.protect = catchAsync(async (req, res, next) => {
  // 1) Getting token and check of it's there
  let token;
  if (
    req.headers.authorization &&
    req.headers.authorization.startsWith('Bearer')
  ) {
    token = req.headers.authorization.split(' ')[1];
  } else if (req.cookies.jwt) {
    token = req.cookies.jwt;
  }

  if (!token) {
    return next(
      new AppError('You are not logged in! Please log in to get access.', 401)
    );
  }

  // 2) Verification token
  const decoded = await promisify(jwt.verify)(token, process.env.JWT_SECRET, {
    algorithms: [JWT_ALGORITHM],
    ...jwtClaims
  });

  // 3) Check if user still exists
  const currentUser = await User.findById(decoded.id).select(
    '+passwordChangedAt'
  );
  if (!currentUser) {
    return next(
      new AppError(
        'The user belonging to this token does no longer exist.',
        401
      )
    );
  }

  // 4) Check if user changed password after the token was issued
  if (currentUser.changedPasswordAfter(decoded.iat)) {
    return next(
      new AppError('User recently changed password! Please log in again.', 401)
    );
  }

  // GRANT ACCESS TO PROTECTED ROUTE
  req.user = currentUser;
  next();
});

exports.restrictTo = (...roles) => {
  return (req, res, next) => {
    // roles ['admin']. role='user'
    if (!roles.includes(req.user.role)) {
      return next(
        new AppError('You do not have permission to perform this action', 403)
      );
    }

    next();
  };
};

exports.forgotPassword = catchAsync(async (req, res, next) => {
  // Responder antes de procurar o utilizador: nem o conteúdo nem o tempo de
  // resposta podem revelar se o email existe (proteção contra enumeração)
  res.status(200).json({
    status: 'success',
    message: 'If that email exists, a password reset token has been sent!'
  });

  // 1) Get user based on POSTed email
  const user = await User.findOne({ email: req.body.email.toLowerCase() });
  if (!user) return;

  // 2) Generate the random reset token
  const resetToken = user.createPasswordResetToken();
  await user.save({ validateBeforeSave: false });

  // 3) Send it to user's email
  try {
    // APP_URL e não o header Host, que é controlado por quem faz o pedido
    const resetURL = `${process.env.APP_URL}/api/v1/users/resetPassword/${resetToken}`;
    await new Email(user, resetURL).sendPasswordReset();
  } catch (err) {
    user.passwordResetToken = undefined;
    user.passwordResetExpires = undefined;
    await user.save({ validateBeforeSave: false });

    console.error('Error sending password reset email:', err);
  }
});

exports.resetPassword = catchAsync(async (req, res, next) => {
  // 1) Get user based on the token
  const hashedToken = crypto
    .createHash('sha256')
    .update(req.params.token)
    .digest('hex');

  // Os campos têm de vir carregados para o token poder ser apagado mais abaixo
  const user = await User.findOne({
    passwordResetToken: hashedToken,
    passwordResetExpires: { $gt: Date.now() }
  }).select('+passwordResetToken +passwordResetExpires');

  // 2) If token has not expired, and there is user, set the new password
  if (!user) {
    return next(new AppError('Token is invalid or has expired', 400));
  }
  user.password = req.body.password;
  user.passwordConfirm = req.body.passwordConfirm;
  user.passwordResetToken = undefined;
  user.passwordResetExpires = undefined;
  await user.save();

  // 3) Update changedPasswordAt property for the user
  // 4) Log the user in, send JWT
  createSendToken(user, 200, res);
});

exports.updatePassword = catchAsync(async (req, res, next) => {
  // 1) Get user from collection
  const user = await User.findById(req.user.id).select('+password');

  // 2) Check if POSTed current password is correct
  if (!(await user.correctPassword(req.body.passwordCurrent, user.password))) {
    return next(new AppError('Your current password is wrong.', 401));
  }

  // 3) If so, update password
  user.password = req.body.password;
  user.passwordConfirm = req.body.passwordConfirm;
  await user.save();
  // User.findByIdAndUpdate will NOT work as intended!

  // 4) Log user in, send JWT
  createSendToken(user, 200, res);
});
