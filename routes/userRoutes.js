const express = require('express');
const userController = require('./../controllers/userController');
const authController = require('./../controllers/authController');
const {
  validateSignup,
  validateLogin,
  validateForgotPassword,
  validateResetPassword,
  validateUpdatePassword,
  validateUpdateUser,
  validate
} = require('./../utils/validation');

const router = express.Router();

router.post('/signup', validateSignup, validate, authController.signup);
router.post('/login', validateLogin, validate, authController.login);
router.get('/logout', authController.logout);

router.post(
  '/forgotPassword',
  validateForgotPassword,
  validate,
  authController.forgotPassword
);
router.patch(
  '/resetPassword/:token',
  validateResetPassword,
  validate,
  authController.resetPassword
);

// Protect all routes after this middleware
router.use(authController.protect);

router.patch(
  '/updateMyPassword',
  validateUpdatePassword,
  validate,
  authController.updatePassword
);
router.get('/me', userController.getMe, userController.getUser);
// A validação vem depois do multer: só então um corpo multipart está disponível
router.patch(
  '/updateMe',
  userController.uploadUserPhoto,
  validateUpdateUser,
  validate,
  userController.resizeUserPhoto,
  userController.updateMe
);
router.delete('/deleteMe', userController.deleteMe);

router.use(authController.restrictTo('admin'));

router.get('/', userController.getAllUsers);

router
  .route('/:id')
  .get(userController.getUser)
  .patch(
    validateUpdateUser,
    validate,
    userController.filterUserUpdate,
    userController.updateUser
  )
  .delete(userController.deleteUser);

module.exports = router;
