// Escapa HTML nos dados recebidos, como defesa extra contra XSS guardado.
// As passwords ficam de fora: só servem para calcular o hash e nunca são mostradas
const escapeHtml = (value, key = '') => {
  if (typeof value === 'string') {
    return /password/i.test(key)
      ? value
      : value.replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  if (Array.isArray(value)) return value.map(item => escapeHtml(item, key));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, escapeHtml(v, k)])
    );
  }
  return value;
};

module.exports = (req, res, next) => {
  req.body = escapeHtml(req.body);
  req.query = escapeHtml(req.query);
  next();
};
