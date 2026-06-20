const { Low } = require('lowdb');
const { JSONFile } = require('lowdb/node');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const dataDir = path.join(__dirname, '../../', 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = path.join(dataDir, 'db.json');

const defaultData = {
  projects: [],
  areas: [],
  sensors: [],
  alerts: [],
  recipients: [],
  notificationRules: [],
  notifications: [],
  receipts: [],
  reminders: []
};

const adapter = new JSONFile(dbPath);
const db = new Low(adapter, defaultData);

const operationQueue = [];
let isOperationRunning = false;

async function runLockedOperation(operation) {
  if (isOperationRunning) {
    return new Promise((resolve, reject) => {
      operationQueue.push({ operation, resolve, reject });
    });
  }

  isOperationRunning = true;

  try {
    let retries = 0;
    const maxRetries = 5;
    let result;
    
    while (retries < maxRetries) {
      try {
        await db.read();
        result = await operation();
        await db.write();
        break;
      } catch (error) {
        retries++;
        if (retries >= maxRetries) {
          throw error;
        }
        await new Promise(r => setTimeout(r, 50 * retries));
      }
    }
    
    return result;
  } finally {
    isOperationRunning = false;
    if (operationQueue.length > 0) {
      const next = operationQueue.shift();
      runLockedOperation(next.operation)
        .then(next.resolve)
        .catch(next.reject);
    }
  }
}

async function initDB() {
  await db.read();
  if (!db.data) {
    db.data = defaultData;
    await db.write();
  }
  Object.keys(defaultData).forEach(key => {
    if (!db.data[key]) {
      db.data[key] = [];
    }
  });
  await db.write();
  return db;
}

class Model {
  constructor(collectionName) {
    this.collectionName = collectionName;
  }

  async findAll(options = {}) {
    await db.read();
    let data = [...db.data[this.collectionName]];

    if (options.where) {
      Object.keys(options.where).forEach(key => {
        const value = options.where[key];
        if (typeof value === 'object' && value !== null) {
          if (value[Object.keys(value)[0]] !== undefined) {
            const op = Object.keys(value)[0];
            const target = value[op];
            switch (op) {
              case '$gte':
                data = data.filter(item => new Date(item[key]) >= new Date(target));
                break;
              case '$lte':
                data = data.filter(item => new Date(item[key]) <= new Date(target));
                break;
              case '$ne':
                data = data.filter(item => item[key] !== target);
                break;
              case '$in':
                data = data.filter(item => target.includes(item[key]));
                break;
            }
          }
        } else if (value && value.$or) {
        } else {
          data = data.filter(item => item[key] === value);
        }
      });
    }

    if (options.where && options.where[Object.keys(options.where)[0]]?.$or) {
      const orConditions = options.where[Object.keys(options.where)[0]].$or;
      data = data.filter(item => {
        return orConditions.some(cond => {
          return Object.keys(cond).every(key => item[key] === cond[key]);
        });
      });
    }

    if (options.order) {
      options.order.forEach(([field, direction]) => {
        data.sort((a, b) => {
          let valA = a[field];
          let valB = b[field];
          if (valA instanceof Date) valA = valA.getTime();
          if (valB instanceof Date) valB = valB.getTime();
          if (valA < valB) return direction === 'ASC' ? -1 : 1;
          if (valA > valB) return direction === 'ASC' ? 1 : -1;
          return 0;
        });
      });
    }

    let count = data.length;

    if (options.limit) {
      const offset = options.offset || 0;
      data = data.slice(offset, offset + options.limit);
    }

    return { count, rows: data.map(item => ({ ...item, get: (key) => item[key] })) };
  }

  async findOne(options = {}) {
    const result = await this.findAll({ ...options, limit: 1 });
    return result.rows[0] || null;
  }

  async findByPk(id, options = {}) {
    await db.read();
    const item = db.data[this.collectionName].find(item => item.id === id);
    return item ? { ...item, get: (key) => item[key] } : null;
  }

  async create(data) {
    return await runLockedOperation(() => {
      const now = new Date();
      const newItem = {
        ...data,
        id: data.id || require('uuid').v4(),
        createdAt: now,
        updatedAt: now,
        deletedAt: null
      };
      db.data[this.collectionName].push(newItem);
      return { ...newItem, get: (key) => newItem[key] };
    });
  }

  async update(id, data) {
    return await runLockedOperation(() => {
      const index = db.data[this.collectionName].findIndex(item => item.id === id);
      if (index === -1) return null;
      db.data[this.collectionName][index] = {
        ...db.data[this.collectionName][index],
        ...data,
        updatedAt: new Date()
      };
      const updated = db.data[this.collectionName][index];
      return { ...updated, get: (key) => updated[key] };
    });
  }

  async destroy(id) {
    return await runLockedOperation(() => {
      const index = db.data[this.collectionName].findIndex(item => item.id === id);
      if (index === -1) return null;
      db.data[this.collectionName][index].deletedAt = new Date();
      return true;
    });
  }

  async count(options = {}) {
    const result = await this.findAll(options);
    return result.count;
  }
}

async function authenticate() {
  await initDB();
  return true;
}

async function sync() {
  await initDB();
  return true;
}

module.exports = {
  db,
  initDB,
  Model,
  authenticate,
  sync,
  DataTypes: {
    UUID: 'uuid',
    STRING: 'string',
    TEXT: 'text',
    INTEGER: 'integer',
    FLOAT: 'float',
    BOOLEAN: 'boolean',
    DATE: 'date',
    ENUM: (...values) => ({ type: 'enum', values }),
    JSON: 'json'
  },
  Op: {
    gte: '$gte',
    lte: '$lte',
    ne: '$ne',
    in: '$in',
    or: '$or'
  }
};
