const MAX_LIMIT = 100;
const MAX_PAGE = 1000000;

const toPositiveInt = (value, fallback, max) => {
  const number = parseInt(value, 10);
  return number > 0 ? Math.min(number, max) : fallback;
};

class APIFeatures {
  constructor(query, queryString) {
    this.query = query;
    this.queryString = queryString;
  }

  // Campos com select: false (ex: password) são invisíveis para o cliente:
  // não podem ser pedidos, filtrados nem usados para ordenar
  isHiddenField(field) {
    const schemaPath = this.query.model.schema.path(field);
    return Boolean(schemaPath) && schemaPath.options.select === false;
  }

  // Lê uma lista de campos separados por vírgulas, como ?sort=-price,name
  fieldList(param) {
    const value = this.queryString[param];
    if (typeof value !== 'string') return [];

    return value
      .split(',')
      .filter(field => /^-?[\w.]+$/.test(field))
      .filter(field => !this.isHiddenField(field.replace(/^-/, '')));
  }

  filter() {
    const queryObj = { ...this.queryString };
    const excludedFields = ['page', 'sort', 'limit', 'fields'];
    excludedFields.forEach(el => delete queryObj[el]);
    Object.keys(queryObj)
      .filter(field => this.isHiddenField(field))
      .forEach(field => delete queryObj[field]);

    // Advanced filtering: só nas chaves, para não alterar os valores
    const queryStr = JSON.stringify(queryObj).replace(
      /"(gte|gt|lte|lt)":/g,
      '"$$$1":'
    );

    this.query = this.query.find(JSON.parse(queryStr));

    return this;
  }

  sort() {
    const sortBy = this.fieldList('sort').join(' ');
    this.query = this.query.sort(sortBy || '-createdAt');

    return this;
  }

  limitFields() {
    const fields = this.fieldList('fields');
    // O MongoDB não aceita misturar inclusão e exclusão: a inclusão prevalece
    const included = fields.filter(field => !field.startsWith('-'));
    const selected = included.length > 0 ? included : fields;

    this.query = this.query.select(selected.join(' ') || '-__v');

    return this;
  }

  paginate() {
    const page = toPositiveInt(this.queryString.page, 1, MAX_PAGE);
    const limit = toPositiveInt(this.queryString.limit, MAX_LIMIT, MAX_LIMIT);
    const skip = (page - 1) * limit;

    this.query = this.query.skip(skip).limit(limit);

    return this;
  }
}
module.exports = APIFeatures;
