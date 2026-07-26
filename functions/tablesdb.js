import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';

// Provide fallback mock Appwrite environment variables for Firebase compatibility
process.env.APPWRITE_FUNCTION_ENDPOINT = process.env.APPWRITE_FUNCTION_ENDPOINT || 'https://localhost';
process.env.APPWRITE_FUNCTION_PROJECT_ID = process.env.APPWRITE_FUNCTION_PROJECT_ID || 'firebase-project';
process.env.APPWRITE_FUNCTION_API_KEY = process.env.APPWRITE_FUNCTION_API_KEY || 'mock-key';

export const ID = {
  unique: () => {
    // Generate a Firestore auto-ID using a dummy collection reference
    return getFirestore().collection('temp').doc().id;
  }
};

export const Query = {
  equal: (attribute, values) => ({ method: 'equal', attribute, values: Array.isArray(values) ? values : [values] }),
  limit: (value) => ({ method: 'limit', values: [value] }),
  offset: (value) => ({ method: 'offset', values: [value] }),
  orderAsc: (attribute) => ({ method: 'orderAsc', attribute }),
  orderDesc: (attribute) => ({ method: 'orderDesc', attribute }),
  lessThan: (attribute, value) => ({ method: 'lessThan', attribute, values: [value] }),
  lessThanEqual: (attribute, value) => ({ method: 'lessThanEqual', attribute, values: [value] }),
  greaterThan: (attribute, value) => ({ method: 'greaterThan', attribute, values: [value] }),
  greaterThanEqual: (attribute, value) => ({ method: 'greaterThanEqual', attribute, values: [value] }),
};

export class Client {
  setEndpoint() { return this; }
  setProject() { return this; }
  setKey() { return this; }
}

export class Users {
  async delete(userId) {
    await getAuth().deleteUser(userId);
    return true;
  }
}

export class Account {
  async get() {
    return { $id: '' };
  }
}

export class TablesDB {
  constructor() {
    this.db = getFirestore();
  }

  async listRows({ tableId, queries = [] }) {
    let ref = this.db.collection(tableId);

    for (const q of queries) {
      if (!q) continue;
      let queryObj = q;
      if (typeof q === 'string') {
        try {
          queryObj = JSON.parse(q);
        } catch {
          // Skip unparseable string queries
          continue;
        }
      }

      let { method, attribute, values } = queryObj;
      if (attribute === '$createdAt') {
        attribute = 'created_at';
      } else if (attribute === '$updatedAt') {
        attribute = 'updated_at';
      }

      if (method === 'equal') {
        if (values.length === 1) {
          ref = ref.where(attribute, '==', values[0]);
        } else if (values.length > 1) {
          ref = ref.where(attribute, 'in', values);
        }
      } else if (method === 'lessThan') {
        ref = ref.where(attribute, '<', values[0]);
      } else if (method === 'lessThanEqual') {
        ref = ref.where(attribute, '<=', values[0]);
      } else if (method === 'greaterThan') {
        ref = ref.where(attribute, '>', values[0]);
      } else if (method === 'greaterThanEqual') {
        ref = ref.where(attribute, '>=', values[0]);
      } else if (method === 'orderDesc') {
        ref = ref.orderBy(attribute, 'desc');
      } else if (method === 'orderAsc') {
        ref = ref.orderBy(attribute, 'asc');
      } else if (method === 'limit') {
        ref = ref.limit(Number(values[0]));
      } else if (method === 'offset') {
        ref = ref.offset(Number(values[0]));
      }
    }

    const snapshot = await ref.get();
    const rows = snapshot.docs.map(doc => ({
      $id: doc.id,
      $createdAt: doc.createTime ? doc.createTime.toDate().toISOString() : null,
      $updatedAt: doc.updateTime ? doc.updateTime.toDate().toISOString() : null,
      ...doc.data()
    }));

    return { rows };
  }

  async getRow({ tableId, rowId }) {
    const doc = await this.db.collection(tableId).doc(rowId).get();
    if (!doc.exists) {
      const err = new Error('Document not found');
      err.code = 404;
      throw err;
    }
    return {
      $id: doc.id,
      $createdAt: doc.createTime ? doc.createTime.toDate().toISOString() : null,
      $updatedAt: doc.updateTime ? doc.updateTime.toDate().toISOString() : null,
      data: doc.data()
    };
  }

  async createRow({ tableId, rowId, data }) {
    const cleanData = this._cleanData(data);
    const docRef = this.db.collection(tableId).doc(rowId);
    await docRef.set(cleanData);
    return { $id: rowId, ...cleanData };
  }

  async updateRow({ tableId, rowId, data }) {
    const cleanData = this._cleanData(data);
    const docRef = this.db.collection(tableId).doc(rowId);
    await docRef.update(cleanData);
    return { $id: rowId };
  }

  async deleteRow({ tableId, rowId }) {
    await this.db.collection(tableId).doc(rowId).delete();
    return true;
  }

  async deleteRows({ tableId }) {
    const collectionRef = this.db.collection(tableId);
    const query = collectionRef.limit(100);
    
    let total = 0;
    while (true) {
      const snapshot = await query.get();
      if (snapshot.size === 0) {
        break;
      }
      const batch = this.db.batch();
      snapshot.docs.forEach((doc) => {
        batch.delete(doc.ref);
      });
      await batch.commit();
      total += snapshot.size;
    }
    return { total };
  }

  // Remove undefined values since Firestore does not allow them
  _cleanData(data) {
    if (!data || typeof data !== 'object') return data;
    const cleaned = {};
    for (const [key, value] of Object.entries(data)) {
      if (value !== undefined) {
        cleaned[key] = value;
      }
    }
    return cleaned;
  }
}
