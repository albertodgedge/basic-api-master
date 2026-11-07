const fs = require('fs');
const multer = require('multer');
const sharp = require('sharp');
const User = require('./../models/userModel');
const catchAsync = require('./../utils/catchAsync');
const AppError = require('./../utils/appError');
const factory = require('./handlerFactory');

// Só estes formatos: SVG, TIFF ou HEIF aumentam a superfície de ataque do sharp
const IMAGE_FORMATS = ['jpeg', 'png', 'webp'];
const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5 MB
// Protege contra imagens minúsculas em disco que ocupam gigabytes em memória
const MAX_IMAGE_PIXELS = 50000000;

const multerStorage = multer.memoryStorage();

const multerFilter = (req, file, cb) => {
  if (IMAGE_FORMATS.some(format => file.mimetype === `image/${format}`)) {
    cb(null, true);
  } else {
    cb(
      new AppError(
        'Not an image! Please upload only JPEG, PNG or WebP images.',
        400
      ),
      false
    );
  }
};

const upload = multer({
  storage: multerStorage,
  fileFilter: multerFilter,
  limits: { fileSize: MAX_IMAGE_BYTES, files: 1 }
});

exports.uploadUserPhoto = upload.single('photo');

exports.resizeUserPhoto = catchAsync(async (req, res, next) => {
  if (!req.file) return next();

  // O mimetype vem do cliente e pode ser falso: o que conta é o conteúdo real
  let photo;
  try {
    const image = sharp(req.file.buffer, {
      limitInputPixels: MAX_IMAGE_PIXELS
    });
    const { format } = await image.metadata();
    if (!IMAGE_FORMATS.includes(format)) throw new Error('Unsupported format');

    photo = await image
      .resize(500, 500)
      .toFormat('jpeg')
      .jpeg({ quality: 90 })
      .toBuffer();
  } catch {
    return next(new AppError('Invalid image file.', 400));
  }

  req.file.filename = `user-${req.user.id}-${Date.now()}.jpeg`;
  await fs.promises.writeFile(`public/img/users/${req.file.filename}`, photo);

  next();
});

const filterObj = (obj, ...allowedFields) => {
  const newObj = {};
  Object.keys(obj).forEach(el => {
    if (allowedFields.includes(el)) newObj[el] = obj[el];
  });
  return newObj;
};

exports.getMe = (req, res, next) => {
  req.params.id = req.user.id;
  next();
};

exports.updateMe = catchAsync(async (req, res, next) => {
  // 1) Create error if user POSTs password data
  if (req.body.password || req.body.passwordConfirm) {
    return next(
      new AppError(
        'This route is not for password updates. Please use /updateMyPassword.',
        400
      )
    );
  }

  // 2) Filtered out unwanted fields names that are not allowed to be updated
  const filteredBody = filterObj(req.body, 'name', 'email');
  if (req.file) filteredBody.photo = req.file.filename;

  // 3) Update user document
  const updatedUser = await User.findByIdAndUpdate(req.user.id, filteredBody, {
    returnDocument: 'after',
    runValidators: true
  });

  res.status(200).json({
    status: 'success',
    data: {
      user: updatedUser
    }
  });
});

exports.deleteMe = catchAsync(async (req, res, next) => {
  await User.findByIdAndUpdate(req.user.id, { active: false });

  res.status(204).json({
    status: 'success',
    data: null
  });
});

// Uma password alterada por aqui ficaria guardada sem hash
exports.filterUserUpdate = (req, res, next) => {
  req.body = filterObj(req.body, 'name', 'email', 'role');
  next();
};

exports.getUser = factory.getOne(User);
exports.getAllUsers = factory.getAll(User);

exports.updateUser = factory.updateOne(User);
exports.deleteUser = factory.deleteOne(User);
