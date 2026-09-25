/**
 * Database query and ID helpers for Firestore queries.
 */
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

export const ID = {
  unique: () => 'doc_' + Math.random().toString(36).substring(2, 15) + Date.now().toString(36),
};
